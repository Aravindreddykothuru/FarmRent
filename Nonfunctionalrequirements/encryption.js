'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

const ALGORITHM = process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm';
const KEY_HEX = process.env.FIELD_ENCRYPTION_KEY || '';
const IV_LENGTH = 12;   // 96-bit IV for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

/**
 * Field-Level Encryption Service
 *
 * Encrypts sensitive database fields at rest:
 * - Bank account numbers
 * - Aadhar/PAN (if stored)
 * - Phone numbers (for privacy)
 * - GST numbers
 *
 * Uses AES-256-GCM (authenticated encryption):
 * - Provides confidentiality (encryption)
 * - Provides integrity (authentication tag)
 * - Prevents padding oracle attacks
 * - Each encryption produces a unique ciphertext (random IV)
 */
class EncryptionService {
  constructor() {
    this.ready = false;
    if (!KEY_HEX || KEY_HEX.length < 32) {
      logger.warn('⚠️  FIELD_ENCRYPTION_KEY not configured — field encryption disabled');
      return;
    }
    this.key = Buffer.from(KEY_HEX.padEnd(64, '0').substring(0, 64), 'hex');
    this.ready = true;
  }

  /**
   * Encrypt a plaintext string
   * Returns: iv:authTag:ciphertext (all base64, colon-separated)
   */
  encrypt(plaintext) {
    if (!this.ready || plaintext === null || plaintext === undefined) return plaintext;

    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_LENGTH });

      const encrypted = Buffer.concat([
        cipher.update(String(plaintext), 'utf8'),
        cipher.final(),
      ]);

      const authTag = cipher.getAuthTag();

      // Format: enc:v1:<iv_b64>:<tag_b64>:<data_b64>
      return `enc:v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
    } catch (err) {
      logger.error('Encryption error:', err.message);
      throw new Error('Data encryption failed');
    }
  }

  /**
   * Decrypt an encrypted string
   */
  decrypt(ciphertext) {
    if (!this.ready || !ciphertext || !String(ciphertext).startsWith('enc:v1:')) {
      return ciphertext; // Return as-is if not encrypted
    }

    try {
      const parts = String(ciphertext).split(':');
      if (parts.length !== 5) throw new Error('Invalid encrypted format');

      const [, , ivB64, tagB64, dataB64] = parts;
      const iv = Buffer.from(ivB64, 'base64');
      const authTag = Buffer.from(tagB64, 'base64');
      const encrypted = Buffer.from(dataB64, 'base64');

      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_LENGTH });
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (err) {
      logger.error('Decryption error:', err.message);
      throw new Error('Data decryption failed — possible data tampering detected');
    }
  }

  /**
   * Encrypt multiple fields in an object
   */
  encryptFields(obj, fields) {
    if (!this.ready) return obj;
    const result = { ...obj };
    for (const field of fields) {
      if (result[field] !== undefined) {
        result[field] = this.encrypt(result[field]);
      }
    }
    return result;
  }

  /**
   * Decrypt multiple fields in an object
   */
  decryptFields(obj, fields) {
    if (!this.ready || !obj) return obj;
    const result = { ...obj };
    for (const field of fields) {
      if (result[field] !== undefined) {
        try {
          result[field] = this.decrypt(result[field]);
        } catch {
          result[field] = '[DECRYPTION_ERROR]';
        }
      }
    }
    return result;
  }

  /**
   * Hash for searchable encrypted fields (blind index)
   * Allows equality search without decrypting all records
   */
  hash(value) {
    if (!value) return null;
    return crypto
      .createHmac('sha256', this.key)
      .update(String(value).toLowerCase().trim())
      .digest('hex');
  }

  /**
   * Check if a value is encrypted
   */
  isEncrypted(value) {
    return typeof value === 'string' && value.startsWith('enc:v1:');
  }
}

// Singleton
const encryptionService = new EncryptionService();
module.exports = encryptionService;
