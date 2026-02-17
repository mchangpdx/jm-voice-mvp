/* modules/retell.js - Fixed & Debug Mode */
const axios = require('axios');
require('dotenv').config();

const RETELL_API_URL = 'https://api.retellai.com';
const API_KEY = process.env.RETELL_API_KEY;

const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
};

// 1. Get KB Info
async function getKnowledgeBase(kbId) {
    try {
        console.log(`[Retell] Fetching KB Info for ID: ${kbId}`);
        const response = await axios.get(`${RETELL_API_URL}/get-knowledge-base/${kbId}`, { headers });
        return response.data;
    } catch (error) {
        logError('Get KB', error);
        throw error;
    }
}

// 2. Delete Source
async function deleteSource(kbId, sourceId) {
    try {
        console.log(`[Retell] Deleting old source: ${sourceId}`);
        await axios.delete(`${RETELL_API_URL}/delete-knowledge-base-source/${kbId}/${sourceId}`, { headers });
    } catch (error) {
        logError('Delete Source', error);
        // Don't throw here, just log it. It's okay if deletion fails.
    }
}

// 3. Add Text Source (Corrected Endpoint)
async function addTextSource(kbId, title, text) {
    try {
        const payload = {
            knowledge_base_id: kbId,
            knowledge_base_source_type: "text", // Explicitly set type
            knowledge_base_texts: [
                {
                    title: title,
                    text: text
                }
            ]
        };

        console.log(`[Retell] Adding new source to ${kbId}...`);

        // Try the standard endpoint based on recent docs patterns
        // Note: Retell API endpoints vary. Using the specific "add" endpoint.
        const response = await axios.post(`${RETELL_API_URL}/add-knowledge-base-source`, payload, { headers });

        console.log(`[Retell] Success! Source added. ID: ${response.data.knowledge_base_source_id}`);
        return response.data;
    } catch (error) {
        logError('Add Source', error);
        throw error;
    }
}

// Helper: Better Error Logger
function logError(context, error) {
    if (error.response) {
        // The request was made and the server responded with a status code
        console.error(`[Retell Error - ${context}] Status: ${error.response.status}`);
        console.error(`[Retell Error - ${context}] Data:`, JSON.stringify(error.response.data, null, 2));
    } else {
        console.error(`[Retell Error - ${context}] Message: ${error.message}`);
    }
}

// Main Update Function
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell] Starting Update Process...');

    // 1. Check if KB exists
    const kbData = await getKnowledgeBase(kbId);

    // 2. Clean up old "Daily Menu" sources
    if (kbData.knowledge_base_sources) {
        for (const source of kbData.knowledge_base_sources) {
            if (source.filename === "Daily Menu" || source.title === "Daily Menu") {
                await deleteSource(kbId, source.knowledge_base_source_id);
            }
        }
    }

    // 3. Add new menu
    await addTextSource(kbId, "Daily Menu", menuText);

    return true;
}

module.exports = { updateMenuInKB };
