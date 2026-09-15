function getJwtSecret() {
    const secret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set in environment variables');
    return secret;
}

function getRefreshSecret() {
    const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_REFRESH_SECRET is not set in environment variables');
    return secret;
}

module.exports = { getJwtSecret, getRefreshSecret };
