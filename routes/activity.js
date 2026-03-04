'use strict';
const axios = require("axios");
const crypto = require("crypto");

// Global Variables - Build URLs from environment variables
const subdomain = process.env.SUBDOMAIN || '';
const authenticationUrl = process.env.authenticationUrl || `https://${subdomain}.auth.marketingcloudapis.com`;
const restBaseURL = process.env.restBaseURL || `https://${subdomain}.rest.marketingcloudapis.com`;
const tokenURL = `${authenticationUrl}/v2/token`;

/*
 * POST Handlers for various routes
 */
exports.edit = function (req, res) {
    res.status(200).json({ success: true });
};

exports.save = async function (req, res) {
    try {
        const payload = req.body;
        await saveToDatabase(payload);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error saving data:', error);
        res.status(500).json({ success: false, error: 'Error saving data' });
    }
};

exports.execute = async function (req, res) {
    try {
        console.log('=== Execute called ===');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        
        const args = (req.body && req.body.inArguments && req.body.inArguments[0]) ? req.body.inArguments[0] : {};

        const destinationDE = (args.destinationDE || process.env.TARGET_DE_KEY || '').trim();
        const upsertKey = args.upsertKey || 'id';
        const fieldMappings = (args.fieldMappings && typeof args.fieldMappings === 'object') ? args.fieldMappings : {};

        console.log('Destination DE:', destinationDE);
        console.log('Upsert Key:', upsertKey);
        console.log('Field Mappings:', JSON.stringify(fieldMappings, null, 2));

        if (!destinationDE) {
            console.error('Execute error: missing destinationDE (set in UI or env TARGET_DE_KEY)');
            return res.status(200).json({ success: false, error: 'Missing destinationDE' });
        }
        
        if (Object.keys(fieldMappings).length === 0) {
            console.error('Execute error: no fields selected for upsert');
            return res.status(200).json({ success: false, error: 'No fields selected' });
        }

        // Journey Builder will have already resolved {{...}} templates into actual values
        const primaryKeyValue = fieldMappings[upsertKey];
        
        if (!primaryKeyValue) {
            console.error(`Execute error: upsert key '${upsertKey}' not found in field mappings`);
            return res.status(200).json({ success: false, error: 'Upsert key not found' });
        }

        const token = await retrieveToken();
        await upsertDataExtensionRow(token, destinationDE, upsertKey, fieldMappings);

        console.log(`Successfully upserted row into DE '${destinationDE}' with ${upsertKey}=${primaryKeyValue}`);
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error during DE upsert execution:', error.response ? error.response.data : error.message);
        return res.status(200).json({ success: false }); // Do not stop the journey
    }
};


exports.publish = function (req, res) {
    res.status(200).json({ success: true });
};

exports.validate = function (req, res) {
    res.status(200).json({ success: true });
};

exports.stop = function (req, res) {
    res.status(200).json({ success: true });
};

/*
 * Function to retrieve an access token
 */
async function retrieveToken() {
    try {
        const clientId = process.env.CLIENT_ID || process.env.clientId;
        const clientSecret = process.env.CLIENT_SECRET || process.env.clientSecret;
        
        if (!clientId || !clientSecret) {
            throw new Error('Missing CLIENT_ID or CLIENT_SECRET environment variables');
        }
        
        const response = await axios.post(tokenURL, {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret
        });
        return response.data.access_token;
    } catch (error) {
        console.error('Error retrieving token:', error.response ? error.response.data : error.message);
        throw error;
    }
}

async function upsertDataExtensionRow(token, dataExtensionKey, primaryKeyField, fieldMappings) {
    if (!restBaseURL) {
        throw new Error('Missing SUBDOMAIN or restBaseURL environment variable');
    }

    const url = `${restBaseURL}/hub/v1/dataevents/key:${encodeURIComponent(dataExtensionKey)}/rowset`;
    
    // Build the keys and values for the upsert
    // fieldMappings already contains resolved values from Journey Builder
    const keys = {
        [primaryKeyField]: fieldMappings[primaryKeyField]
    };
    
    const rowsetPayload = [
        {
            keys: keys,
            values: fieldMappings
        }
    ];

    console.log('Upserting to DE:', JSON.stringify(rowsetPayload, null, 2));

    await axios.post(url, rowsetPayload, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
}

/*
 * GET Handler for /journeys route
 */
exports.getJourneys = async function (req, res) {
    res.status(404).json({ error: 'Not implemented in DE copy mode' });
}

/*
 * Function to retrieve journeys
 */
async function fetchJourneys() {
    throw new Error('Not implemented');
}

/*
 * Handler to get activity data by UUID
 */
exports.getActivityByUUID = async function (req, res) {
    res.status(404).send('Not implemented in DE copy mode');
}


/*
 * Function to save data to the database
 */
async function saveToDatabase() {
    return;
}

// ═══════════════════════════════════════════════════════════════════════
//  NEW ENDPOINTS – Multi-screen POC
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /webhook/submit
 * Proxies the form data to the CloudPage JSON Code Resource (if configured),
 * which generates a GUID and saves directly to DEs inside SFMC.
 * Falls back to REST API upsert if no CloudPage URL is set.
 */
exports.webhookSubmit = async function (req, res) {
    try {
        const { firstname, lastname, email, phone, country, jobId: clientJobId } = req.body || {};

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required.' });
        }

        // ── Strategy 1: Proxy to CloudPage (preferred) ──────────
        const cloudPageUrl = (process.env.CLOUDPAGE_WEBHOOK_URL || '').trim();
        if (cloudPageUrl) {
            console.log('Proxying webhook to CloudPage:', cloudPageUrl);
            try {
                const cpResponse = await axios.post(cloudPageUrl, {
                    firstname: firstname || '',
                    lastname: lastname || '',
                    email,
                    phone: phone || '',
                    country: country || ''
                }, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000,
                    // Force text so we can manually strip HTML wrappers
                    responseType: 'text'
                });

                console.log('CloudPage raw response type:', typeof cpResponse.data);

                // If axios already parsed JSON, use it directly
                let parsed;
                if (typeof cpResponse.data === 'object' && cpResponse.data !== null) {
                    parsed = cpResponse.data;
                } else {
                    const rawData = String(cpResponse.data);
                    console.log('CloudPage raw response (first 300 chars):', rawData.substring(0, 300));

                    // Sanity check: if response contains Node.js code, the CloudPage URL is wrong
                    if (rawData.includes("'use strict'") || rawData.includes('require("axios")') || rawData.includes('exports.')) {
                        console.error('CloudPage returned server-side JS code – the CLOUDPAGE_WEBHOOK_URL is pointing to the wrong resource!');
                        return res.status(500).json({
                            success: false,
                            error: 'CloudPage returned server code instead of JSON. Check that CLOUDPAGE_WEBHOOK_URL points to your SFMC JSON Code Resource (with the SSJS webhook code), not to the Vercel app or wrong page.'
                        });
                    }

                    // CloudPage SSJS may wrap JSON in HTML tags – strip them
                    let rawText = rawData.replace(/<[^>]*>/g, '').trim();

                    try { parsed = JSON.parse(rawText); } catch (pe) {
                        console.error('Failed to parse CloudPage response as JSON:', rawText.substring(0, 500));
                        parsed = null;
                    }
                }

                console.log('CloudPage parsed response:', JSON.stringify(parsed));

                // ── Log detailed CloudPage save statuses ──
                if (parsed && parsed.saveStatus) {
                    console.log('=== CloudPage DE Save Results ===');
                    console.log('  Webhook DE status    :', parsed.saveStatus.webhookDE);
                    console.log('  Job Tracking DE status:', parsed.saveStatus.jobTrackingDE);
                    console.log('  JobID                :', parsed.jobId);
                    console.log('=================================');
                }

                // Forward CloudPage response directly to client
                if (parsed && parsed.success && parsed.jobId) {
                    return res.status(200).json(parsed);
                } else if (parsed) {
                    // CloudPage returned a response but missing jobId or not success
                    console.warn('CloudPage response missing jobId or not success:', JSON.stringify(parsed));
                    return res.status(200).json(parsed);
                } else {
                    return res.status(500).json({ success: false, error: 'CloudPage returned unparseable response.' });
                }
            } catch (cpErr) {
                console.error('CloudPage proxy failed:', cpErr.message);
                return res.status(500).json({ success: false, error: 'CloudPage call failed: ' + cpErr.message });
            }
        }

        // No CloudPage URL configured
        return res.status(400).json({ success: false, error: 'CLOUDPAGE_WEBHOOK_URL environment variable is not set.' });
    } catch (error) {
        console.error('webhookSubmit error:', error.response ? error.response.data : error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /de/entry-records?eventDefKey=DEAudience-xxxx
 * Automatically resolves the journey Event Definition Key to the actual DE,
 * then returns the top 2 rows.  No manual env-var configuration needed.
 *
 * Flow:
 *   1. GET /interaction/v1/eventDefinitions/key:{eventDefKey}
 *      → response contains dataExtensionId (DE ObjectID)
 *   2. GET /data/v1/customobjectdata/{dataExtensionId}/rowset?$page=1&$pageSize=2
 *      → returns DE rows
 */
exports.getEntryDeRecords = async function (req, res) {
    try {
        const eventDefKey = (req.query.eventDefKey || '').trim();
        if (!eventDefKey) {
            return res.status(400).json({ success: false, error: 'Missing eventDefKey query parameter.' });
        }

        console.log('=== getEntryDeRecords called with eventDefKey:', eventDefKey, '===');

        const hasCredentials = (process.env.CLIENT_ID || process.env.clientId) &&
                               (process.env.CLIENT_SECRET || process.env.clientSecret) &&
                               subdomain;

        if (!hasCredentials) {
            console.log('[Mock] No SFMC credentials – returning sample records');
            return res.status(200).json({
                success: true,
                records: [
                    { SubscriberKey: 'mock-001', FirstName: 'Jane', LastName: 'Doe', Email: 'jane@example.com' },
                    { SubscriberKey: 'mock-002', FirstName: 'John', LastName: 'Smith', Email: 'john@example.com' }
                ]
            });
        }

        const token = await retrieveToken();

        // Step 1 – Resolve Event Definition Key → dataExtensionId
        const eventDefUrl = `${restBaseURL}/interaction/v1/eventDefinitions/key:${encodeURIComponent(eventDefKey)}`;
        console.log('Fetching event definition from:', eventDefUrl);

        const eventDefRes = await axios.get(eventDefUrl, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const dataExtensionId = eventDefRes.data && eventDefRes.data.dataExtensionId;
        if (!dataExtensionId) {
            console.error('Event definition response missing dataExtensionId:', JSON.stringify(eventDefRes.data));
            return res.status(200).json({ success: false, error: 'Could not resolve DE from Event Definition.' });
        }

        console.log('Resolved dataExtensionId:', dataExtensionId);

        // Step 2 – Fetch top 2 rows using the DE ObjectID (no "key/" prefix)
        const rowsetUrl = `${restBaseURL}/data/v1/customobjectdata/${encodeURIComponent(dataExtensionId)}/rowset?$page=1&$pageSize=2`;
        console.log('Fetching DE rows from:', rowsetUrl);

        const rowsetRes = await axios.get(rowsetUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        // Normalise items
        let records = [];
        if (rowsetRes.data && rowsetRes.data.items) {
            records = rowsetRes.data.items.map(item => Object.assign({}, item.keys || {}, item.values || {}));
        } else if (Array.isArray(rowsetRes.data)) {
            records = rowsetRes.data.map(item => {
                return (item.keys || item.values) ? Object.assign({}, item.keys || {}, item.values || {}) : item;
            });
        }

        console.log('Returning', records.length, 'entry DE records');
        return res.status(200).json({ success: true, records });
    } catch (error) {
        const errData = error.response ? JSON.stringify(error.response.data) : error.message;
        const errStatus = error.response ? error.response.status : 'N/A';
        console.error(`getEntryDeRecords error [${errStatus}]:`, errData);
        return res.status(200).json({ success: false, error: `Entry DE fetch failed (${errStatus}): ${errData}` });
    }
};

/**
 * GET /de/records/:deKey
 * Returns the top 2 rows from the specified Data Extension.
 */
exports.getDeRecords = async function (req, res) {
    try {
        const deKey = (req.params.deKey || '').trim();
        if (!deKey) {
            return res.status(400).json({ success: false, error: 'Missing DE key.' });
        }

        console.log('=== getDeRecords called for DE:', deKey, '===');

        const hasCredentials = (process.env.CLIENT_ID || process.env.clientId) &&
                               (process.env.CLIENT_SECRET || process.env.clientSecret) &&
                               subdomain;

        if (!hasCredentials) {
            console.log('[Mock] Returning sample records for DE:', deKey);
            return res.status(200).json({
                success: true,
                records: [
                    { SubscriberKey: 'mock-001', FirstName: 'Jane', LastName: 'Doe', Email: 'jane@example.com' },
                    { SubscriberKey: 'mock-002', FirstName: 'John', LastName: 'Smith', Email: 'john@example.com' }
                ]
            });
        }

        const token = await retrieveToken();

        // SFMC REST: retrieve DE rows via /data/v1/customobjectdata
        const url = `${restBaseURL}/data/v1/customobjectdata/key/${encodeURIComponent(deKey)}/rowset?$page=1&$pageSize=2`;
        console.log('Fetching DE records from:', url);

        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('DE records response status:', response.status);
        console.log('DE records response keys:', Object.keys(response.data || {}));

        // Normalise – response.data.items is an array of { keys: {}, values: {} }
        let records = [];
        if (response.data && response.data.items) {
            records = response.data.items.map(function (item) {
                return Object.assign({}, item.keys || {}, item.values || {});
            });
        } else if (Array.isArray(response.data)) {
            // Some endpoints return a plain array
            records = response.data.map(function (item) {
                if (item.keys || item.values) {
                    return Object.assign({}, item.keys || {}, item.values || {});
                }
                return item;
            });
        }

        console.log('Returning', records.length, 'records');
        return res.status(200).json({ success: true, records });
    } catch (error) {
        const errData = error.response ? JSON.stringify(error.response.data) : error.message;
        const errStatus = error.response ? error.response.status : 'N/A';
        console.error(`getDeRecords error [${errStatus}]:`, errData);
        return res.status(200).json({ success: false, error: `DE fetch failed (${errStatus}): ${errData}` });
    }
};
