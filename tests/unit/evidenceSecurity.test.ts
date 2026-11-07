import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import { evidenceProcessor } from '../../src/server/evidenceProcessor';
import { db } from '../../src/server/database';

describe('Evidence Security & Private Pipeline Tests', () => {
  beforeEach(() => {
    // Reset db cases
    db.cases['case-ev-01'] = {
      id: 'case-ev-01',
      tenantId: 'tenant-test',
      caseNumber: 'FR-EV-001',
      orderId: 'ord-1',
      orderNumber: 'APX-01',
      paypalOrderId: 'PPO-1',
      paypalCaptureId: 'CAP-1',
      customerName: 'Customer One',
      customerEmail: 'cust1@test.com',
      status: 'AWAITING_EVIDENCE',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Item broken',
      customerAccessToken: 'tok-1',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      evidence: [],
      timeline: [],
      refundAttempts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  it('validates authentic JPEG magic bytes (FF D8 FF) and rejects fake image extensions', () => {
    // 1. Valid JPEG header
    const validJpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const sigJpeg = evidenceProcessor.validateSignature(validJpegHeader);
    expect(sigJpeg.isValid).toBe(true);
    expect(sigJpeg.mimeType).toBe('image/jpeg');

    // 2. Valid PNG header (89 50 4E 47 0D 0A 1A 0A)
    const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const sigPng = evidenceProcessor.validateSignature(validPngHeader);
    expect(sigPng.isValid).toBe(true);
    expect(sigPng.mimeType).toBe('image/png');

    // 3. Fake JPEG: Text script named 'malicious.jpg'
    const fakeTextFile = Buffer.from('<?php echo "malicious script payload"; ?>');
    const sigFake = evidenceProcessor.validateSignature(fakeTextFile);
    expect(sigFake.isValid).toBe(false);
    expect(sigFake.mimeType).toBe('');

    // 4. Executable / ELF binary
    const elfBinary = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const sigElf = evidenceProcessor.validateSignature(elfBinary);
    expect(sigElf.isValid).toBe(false);
  });

  it('processes, sanitizes, and strips EXIF metadata from uploaded images', async () => {
    // Create a real small 100x100 JPEG buffer
    const rawImageBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    const result = await evidenceProcessor.processUpload(
      'case-ev-01',
      'damaged_photo.jpg',
      rawImageBuffer,
      'item_photo',
      'Test photo of damage'
    );

    expect(result.evidence).toBeDefined();
    expect(result.evidence.sha256Hash).toHaveLength(64);
    expect(result.evidence.mimeType).toBe('image/jpeg');
    expect(result.evidence.thumbnailBase64).toContain('data:image/jpeg;base64,');
    expect(result.evidence.scanStatus).toBe('unscanned'); // Truthful scanning status
    expect(result.isDuplicate).toBe(false);
  });

  it('detects cross-case duplicate SHA-256 hash collisions when an identical image is re-used', async () => {
    const rawImageBuffer = await sharp({
      create: {
        width: 80,
        height: 80,
        channels: 3,
        background: { r: 0, g: 120, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();

    // 1. First upload in Case 1
    const upload1 = await evidenceProcessor.processUpload(
      'case-ev-01',
      'broken_speaker.jpg',
      rawImageBuffer,
      'item_photo'
    );
    db.cases['case-ev-01'].evidence.push(upload1.evidence);
    expect(upload1.isDuplicate).toBe(false);

    // 2. Second upload in a completely different Case 2 using the same exact photo
    db.cases['case-ev-02'] = {
      id: 'case-ev-02',
      tenantId: 'tenant-test',
      caseNumber: 'FR-EV-002',
      orderId: 'ord-2',
      orderNumber: 'APX-02',
      paypalOrderId: 'PPO-2',
      paypalCaptureId: 'CAP-2',
      customerName: 'Customer Two',
      customerEmail: 'cust2@test.com',
      status: 'AWAITING_EVIDENCE',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Speaker cracked',
      customerAccessToken: 'tok-2',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      evidence: [],
      timeline: [],
      refundAttempts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const upload2 = await evidenceProcessor.processUpload(
      'case-ev-02',
      'reused_photo.jpg',
      rawImageBuffer,
      'item_photo'
    );

    // Must detect duplicate hash collision!
    expect(upload2.isDuplicate).toBe(true);
    expect(upload2.duplicateCaseIds).toContain('case-ev-01');
    expect(upload2.evidence.scanStatus).toBe('suspicious');
  });

  it('rejects files exceeding the 10MB file-size limit', async () => {
    // 11MB dummy buffer with JPEG header
    const hugeBuffer = Buffer.alloc(11 * 1024 * 1024);
    hugeBuffer[0] = 0xff;
    hugeBuffer[1] = 0xd8;
    hugeBuffer[2] = 0xff;

    await expect(
      evidenceProcessor.processUpload('case-ev-01', 'too_large.jpg', hugeBuffer)
    ).rejects.toThrow('File exceeds maximum permitted size of 10MB');
  });
});
