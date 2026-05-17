'use strict';

/**
 * In-memory dev email store.
 * Captures all emails sent in development so they can be viewed at /dev/emails.
 * Never used in production.
 */

const MAX_EMAILS = 50;
const emails = [];
let counter = 0;

function extractLinks(html) {
    const links = [];
    const re = /href=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const url = m[1];
        if (url.startsWith('http') || url.startsWith('/')) links.push(url);
    }
    return [...new Set(links)];
}

function store(email) {
    if (process.env.NODE_ENV === 'production') return;
    const entry = {
        id:        ++counter,
        timestamp: new Date().toISOString(),
        to:        email.to,
        subject:   email.subject,
        html:      email.html,
        links:     extractLinks(email.html || ''),
    };
    emails.unshift(entry);
    if (emails.length > MAX_EMAILS) emails.length = MAX_EMAILS;
}

function getAll()   { return emails; }
function clear()    { emails.length = 0; }

module.exports = { store, getAll, clear };
