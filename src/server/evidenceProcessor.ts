/**
 * FairResolve Private Evidence Processing Pipeline
 * Enforces magic-byte inspection, file-size limits, cryptographic SHA-256 fingerprinting,
 * cross-case duplicate collision detection, and private storage isolation.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EvidenceObject } from '../types';
import { store } from './store';

const UPLOADS_DIR = path.resolve(process.cwd(), 'private_uploads');

// Ensure private uploads directory exists
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
  validateSignature(buffer: Buffer): { isValid: boolean; mimeType: string; ext: string } {
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
   * Process and quarantine upload
   */
  async processUpload(
    caseId: string,
    originalFilename: string,
    fileBuffer: Buffer,
    evidenceType: EvidenceObject['evidenceType'] = 'item_photo',
    caption?: string
  ): Promise<ProcessUploadResult> {
    // 1. Enforce max 5MB size limit
    const MAX_SIZE = 5 * 1024 * 1024;
    if (fileBuffer.length > MAX_SIZE) {
      throw new Error(`File exceeds maximum permitted size of 5MB (Actual: ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
    }

    // 2. Validate real byte signature (never trust client extension)
    const { isValid, mimeType, ext } = this.validateSignature(fileBuffer);
    if (!isValid) {
      throw new Error('Unsupported or malformed file format. Only valid JPEG, PNG, and WEBP images are accepted.');
    }

    // 3. Compute exact SHA-256 hash
    const sha256Hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 4. Cross-case duplicate hash check
    const duplicateCaseIds = store.findDuplicateEvidence(sha256Hash, caseId);
    const isDuplicate = duplicateCaseIds.length > 0;

    // 5. Store privately with unpredictable UUID filename
    const fileId = `ev-${crypto.randomUUID().substring(0, 12)}`;
    const storageFilename = `${fileId}.${ext}`;
    const storagePath = path.join(UPLOADS_DIR, storageFilename);

    await fs.promises.writeFile(storagePath, fileBuffer);

    // Create thumbnail base64 preview (inline for rapid UI response)
    const previewBase64 = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;

    const evidence: EvidenceObject = {
      id: fileId,
      caseId,
      originalFilename: path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, '_'),
      mimeType,
      byteSize: fileBuffer.length,
      sha256Hash,
      isDuplicate,
      duplicateCaseIds: isDuplicate ? duplicateCaseIds : undefined,
      uploadedAt: new Date().toISOString(),
      scanStatus: isDuplicate ? 'suspicious' : 'clean',
      evidenceType,
      caption,
      downloadUrl: `/api/v1/evidence/${fileId}/file`,
      thumbnailBase64: previewBase64,
    };

    return {
      evidence,
      isDuplicate,
      duplicateCaseIds,
    };
  }

  getFilePath(fileId: string): string | null {
    // Find matching file in UPLOADS_DIR
    const files = fs.readdirSync(UPLOADS_DIR);
    const match = files.find((f) => f.startsWith(`${fileId}.`));
    if (!match) return null;
    return path.join(UPLOADS_DIR, match);
  }
}

export const evidenceProcessor = new EvidenceProcessor();
