const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('./logger');

const bucketName = process.env.AWS_S3_BUCKET || 'farmrent-assets';
const s3Region = process.env.AWS_REGION || 'ap-south-1';

// Initialize S3 client.
// Supports both direct AWS S3 and any S3-compatible service (like Supabase S3 API)
let s3Client;

const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const endpoint = process.env.AWS_S3_ENDPOINT; // For S3-compatible services like Supabase

if (accessKeyId && secretAccessKey) {
    const s3Config = {
        region: s3Region,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    };
    if (endpoint) {
        s3Config.endpoint = endpoint;
        s3Config.forcePathStyle = true; // Required for Supabase/MinIO
    }
    s3Client = new S3Client(s3Config);
    logger.info('[S3] Client successfully initialized');
} else {
    logger.warn('[S3] Missing credentials. S3 client not initialized. Falling back to mock uploads.');
}

/**
 * Uploads a buffer directly to the S3 bucket.
 */
async function uploadToS3(key, buffer, contentType) {
    if (!s3Client) {
        logger.debug('[S3] Mock upload triggered for key:', key);
        return `https://mock-s3-storage.local/${bucketName}/${key}`;
    }

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
    });

    await s3Client.send(command);

    // In standard AWS, the public URL layout matches this.
    // For S3-compat (like Supabase), we map to the public endpoint.
    if (endpoint) {
        return `${endpoint}/${bucketName}/${key}`;
    }
    return `https://${bucketName}.s3.${s3Region}.amazonaws.com/${key}`;
}

/**
 * Deletes an object from the S3 bucket.
 */
async function deleteFromS3(key) {
    if (!s3Client) {
        logger.debug('[S3] Mock delete triggered for key:', key);
        return;
    }

    const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
    });

    await s3Client.send(command);
}

/**
 * Generates a presigned PUT URL for client-side direct S3 uploads.
 */
async function getPresignedUploadUrl(key, contentType, expiresIn = 3600) {
    if (!s3Client) {
        return `https://mock-s3-storage.local/upload-presign-mock?key=${key}`;
    }

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: contentType,
    });

    return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Generates a presigned GET URL for secure access to private files (e.g. KYC docs).
 */
async function getPresignedDownloadUrl(key, expiresIn = 3600) {
    if (!s3Client) {
        return `https://mock-s3-storage.local/download-presign-mock?key=${key}`;
    }

    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
    });

    return getSignedUrl(s3Client, command, { expiresIn });
}

module.exports = {
    uploadToS3,
    deleteFromS3,
    getPresignedUploadUrl,
    getPresignedDownloadUrl,
    bucketName,
};
