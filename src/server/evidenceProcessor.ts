/**
 * FairResolve Private Evidence Processing Pipeline
 *
 * Implements:
 * - Magic-byte inspection (JPEG, PNG, WEBP)
 * - Safe image decoding, EXIF metadata stripping, and sanitizing re-encoding via Sharp
 * - Decompression bomb defense (max 8000x8000 px, max 30MP)
 * - Cryptographic SHA-256 fingerprinting on sanitized file content
 * - Tenant-scoped duplicate hash collision detection
 * - Truthful scanStatus tracking: 'unscanned' unless scanned by an actual scanner
 * - Scaled thumbnail generation (< 40KB) to prevent unbounded memory growth in API payloads
 * - Private storage with UUIDs and authorized-only retrieval
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp, { Metadata } from 'sharp';
import { EvidenceObject } from '../types';
import { db } from './database';

const UPLOADS_DIR = path.resolve(process.cwd(), 'private_uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export interface ProcessUploadResult {
  evidence: EvidenceObject;
  isDuplicate: boolean;
  duplicateCaseIds: string[];
}

export class EvidenceProcessor {
  /**
   * Validate file buffer signature against accepted MIME types
   */
  public validateSignature(buffer: Buffer): { isValid: boolean; mimeType: string; ext: string } {
    if (buffer.length < 12) {
      return { isValid: false, mimeType: '', ext: '' };
    }

    // JPEG signature: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { isValid: true, mimeType: 'image/jpeg', ext: 'jpg' };
    }

    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { isValid: true, mimeType: 'image/png', ext: 'png' };
    }

    // WEBP signature: RIFF ... WEBP
    const riff = buffer.toString('ascii', 0, 4);
    const webp = buffer.toString('ascii', 8, 12);
    if (riff === 'RIFF' && webp === 'WEBP') {
      return { isValid: true, mimeType: 'image/webp', ext: 'webp' };
    }

    return { isValid: false, mimeType: '', ext: '' };
  }

  /**
   * Process, sanitize, decode and re-encode upload using Sharp
   */
  async processUpload(
    caseId: string,
    originalFilename: string,
    fileBuffer: Buffer,
    evidenceType: EvidenceObject['evidenceType'] = 'item_photo',
    caption?: string
  ): Promise<ProcessUploadResult> {
    // 1. Enforce max 10MB size limit
    const MAX_SIZE = 10 * 1024 * 1024;
    if (fileBuffer.length > MAX_SIZE) {
      throw new Error(
        `File exceeds maximum permitted size of 10MB (Actual: ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB)`
      );
    }

    // 2. Validate real byte signature (magic bytes)
    const { isValid, mimeType, ext } = this.validateSignature(fileBuffer);
    if (!isValid) {
      throw new Error(
        'Unsupported or malformed file format. Only authentic JPEG, PNG, and WEBP images are accepted.'
      );
    }

    // 3. Decompression bomb protection & safe decoding via Sharp
    let metadata: Metadata;
    let sanitizedBuffer: Buffer;
    let thumbnailBase64: string;

    try {
      const imageInstance = sharp(fileBuffer);
      metadata = await imageInstance.metadata();

      const width = metadata.width || 0;
      const height = metadata.height || 0;
      const totalPixels = width * height;

      if (width > 8000 || height > 8000 || totalPixels > 30000000) {
        throw new Error(
          `Image resolution (${width}x${height}, ${totalPixels} pixels) exceeds safe limit of 8000x8000 / 30MP.`
        );
      }

      // Re-encode to strip malicious EXIF, ICC profiles, and non-image payloads
      if (ext === 'jpg') {
        sanitizedBuffer = await sharp(fileBuffer)
          .rotate() // Auto-orient based on EXIF before stripping
          .jpeg({ quality: 88, mozjpeg: true })
          .toBuffer();
      } else if (ext === 'png') {
        sanitizedBuffer = await sharp(fileBuffer)
          .png({ compressionLevel: 8 })
          .toBuffer();
      } else {
        sanitizedBuffer = await sharp(fileBuffer)
          .webp({ quality: 85 })
          .toBuffer();
      }

      // Generate compact thumbnail (max 360px width, ~20-40KB)
      const thumbBuf = await sharp(sanitizedBuffer)
        .resize({ width: 360, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();

      thumbnailBase64 = `data:image/jpeg;base64,${thumbBuf.toString('base64')}`;
    } catch (err: any) {
      throw new Error(`Corrupted or unsafe image file: ${err.message}`);
    }

    // 4. Compute cryptographic SHA-256 fingerprint on sanitized image
    const sha256Hash = crypto.createHash('sha256').update(sanitizedBuffer).digest('hex');

    // 5. Cross-case duplicate hash check
    const duplicateCaseIds = db.findDuplicateEvidence(sha256Hash, caseId);
    const isDuplicate = duplicateCaseIds.length > 0;

    // 6. Store privately with unpredictable UUID filename
    const fileId = `ev-${crypto.randomUUID().substring(0, 12)}`;
    const storageFilename = `${fileId}.${ext}`;
    const storagePath = path.join(UPLOADS_DIR, storageFilename);

    await fs.promises.writeFile(storagePath, sanitizedBuffer);

    // 7. Truthful scan status (Never claim clean without a real antivirus/malware scanner)
    const scanStatus: EvidenceObject['scanStatus'] = isDuplicate ? 'suspicious' : 'unscanned';

    const evidence: EvidenceObject = {
      id: fileId,
      caseId,
      originalFilename: path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, '_'),
      mimeType,
      byteSize: sanitizedBuffer.length,
      width: metadata.width,
      height: metadata.height,
      sha256Hash,
      isDuplicate,
      duplicateCaseIds: isDuplicate ? duplicateCaseIds : undefined,
      uploadedAt: new Date().toISOString(),
      scanStatus,
      evidenceType,
      caption,
      downloadUrl: `/api/v1/evidence/${fileId}/file`,
      thumbnailBase64,
    };

    return {
      evidence,
      isDuplicate,
      duplicateCaseIds,
    };
  }

  public getFilePath(fileId: string): string | null {
    if (!fileId || typeof fileId !== 'string') return null;
    const sanitized = fileId.replace(/[^a-zA-Z0-9_-]/g, '');
    const files = fs.readdirSync(UPLOADS_DIR);
    const match = files.find((f) => f.startsWith(`${sanitized}.`));
    if (!match) return null;
    return path.join(UPLOADS_DIR, match);
  }
}

export const evidenceProcessor = new EvidenceProcessor();
