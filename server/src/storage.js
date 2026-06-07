/* ============================================================
 *  Attachment storage abstraction.
 *
 *  Selected by env:
 *    S3_BUCKET set  → S3Storage  (presigned download URLs)
 *    S3_BUCKET unset → LocalStorage  (UPLOAD_DIR, local disk)
 *
 *  Key scheme (built by caller):
 *    ${entityType}/${entityId}/${crypto.randomUUID()}-${safeName}
 *
 *  Interface:
 *    put(key, buffer, contentType) → Promise<void>
 *    getUrl(key, filename)         → Promise<string|null>
 *    getStream(key)                → ReadableStream  (local only)
 *    delete(key)                   → Promise<void>
 * ========================================================== */

'use strict';

const fs   = require('fs');
const path = require('path');

// ============================================================
//  LocalStorage — files under UPLOAD_DIR
// ============================================================
class LocalStorage {
  constructor() {
    this._dir = process.env.UPLOAD_DIR || '/data/uploads';
    // Ensure the upload directory exists when the store is first used.
    fs.mkdirSync(this._dir, { recursive: true });
  }

  _fullPath(key) {
    // key may contain slashes (entity/id/uuid-name). Treat as relative sub-path.
    return path.join(this._dir, ...key.split('/'));
  }

  async put(key, buffer, _contentType) {
    const dest = this._fullPath(key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, buffer);
  }

  // Local storage has no pre-signed URL; caller will stream the file.
  async getUrl(_key, _filename) {
    return null;
  }

  getStream(key) {
    return fs.createReadStream(this._fullPath(key));
  }

  async delete(key) {
    try {
      await fs.promises.unlink(this._fullPath(key));
    } catch (e) {
      // Ignore "file not found" — idempotent delete is fine.
      if (e.code !== 'ENOENT') throw e;
    }
  }
}

// ============================================================
//  S3Storage — AWS S3 via @aws-sdk/client-s3
// ============================================================
class S3Storage {
  constructor() {
    const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    this._bucket      = process.env.S3_BUCKET;
    this._region      = process.env.AWS_REGION || 'us-east-1';
    this._client      = new S3Client({ region: this._region });
    this._PutObjectCommand    = PutObjectCommand;
    this._DeleteObjectCommand = DeleteObjectCommand;
    this._GetObjectCommand    = GetObjectCommand;
    this._getSignedUrl        = getSignedUrl;
  }

  async put(key, buffer, contentType) {
    await this._client.send(new this._PutObjectCommand({
      Bucket:      this._bucket,
      Key:         key,
      Body:        buffer,
      ContentType: contentType || 'application/octet-stream',
    }));
  }

  async getUrl(key, filename) {
    const command = new this._GetObjectCommand({
      Bucket:                     this._bucket,
      Key:                        key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });
    return this._getSignedUrl(this._client, command, { expiresIn: 300 });
  }

  // S3Storage doesn't stream locally; not called in S3 mode.
  getStream(_key) {
    throw new Error('getStream is not supported in S3 mode');
  }

  async delete(key) {
    await this._client.send(new this._DeleteObjectCommand({
      Bucket: this._bucket,
      Key:    key,
    }));
  }
}

// ============================================================
//  Select implementation based on env and export as singleton.
// ============================================================
const storage = process.env.S3_BUCKET ? new S3Storage() : new LocalStorage();

module.exports = { storage, LocalStorage, S3Storage };
