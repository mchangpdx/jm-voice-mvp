/* modules/retell.js - Production Grade (Pure Axios) */
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const RETELL_API_URL = 'https://api.retellai.com';
const API_KEY = process.env.RETELL_API_KEY;

// Helper to get headers
function getCommonHeaders() {
    return {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
    };
}

// 1. Get KB Info
async function getKnowledgeBase(kbId) {
    try {
        const response = await axios.get(`${RETELL_API_URL}/get-knowledge-base/${kbId}`, {
            headers: getCommonHeaders()
        });
        return response.data;
    } catch (error) {
        console.error(`[Retell] Get KB Error: ${error.message}`);
        throw error;
    }
}

// 2. Delete Source (CORRECTED URL)
async function deleteSource(sourceId) {
    try {
        if (!sourceId) return;

        console.log(`[Retell] Deleting source: ${sourceId}`);

        // [FIXED] The API endpoint is /delete-knowledge-base-source/{source_id}
        await axios.delete(`${RETELL_API_URL}/delete-knowledge-base-source/${sourceId}`, {
            headers: getCommonHeaders()
        });

        console.log(`[Retell] Deleted: ${sourceId}`);
    } catch (error) {
        // Ignore 404 (already deleted)
        if (error.response && error.response.status === 404) {
            console.log(`[Retell] Source already deleted: ${sourceId}`);
            return;
        }
        console.warn(`[Retell] Delete Warning: ${error.message}`);
    }
}

// 3. Add Text Source (Multipart/Form-Data)
async function addTextSource(kbId, menuText) {
    try {
        const now = new Date();
        const timeString = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${now.getHours()}h${now.getMinutes()}m`;
        const uniqueTitle = `Daily Menu ${timeString}`;

        console.log(`[Retell] Uploading: "${uniqueTitle}"`);

        const form = new FormData();
        const textsPayload = JSON.stringify([
            {
                title: uniqueTitle,
                text: menuText
            }
        ]);

        form.append('knowledge_base_texts', textsPayload);

        // Axios Post with Multipart Headers
        const response = await axios.post(
            `${RETELL_API_URL}/add-knowledge-base-sources/${kbId}`,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${API_KEY}`
                }
            }
        );

        console.log(`[Retell] Success! New Source Added.`);
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error(`[Retell Error] Status: ${error.response.status}`);
            console.error(`[Retell Error] Data:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(`[Retell Error] ${error.message}`);
        }
        throw error;
    }
}

// Main Logic
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell] Starting Menu Sync...');

    // A. Fetch Current Sources
    const kbData = await getKnowledgeBase(kbId);

    // B. Smart Cleanup
    if (kbData.knowledge_base_sources) {
        const oldMenus = kbData.knowledge_base_sources.filter(source =>
            source.title && source.title.includes("Daily Menu")
        );

        if (oldMenus.length > 0) {
            console.log(`[Retell] Found ${oldMenus.length} old menu(s). Cleaning up...`);

            // Delete all old menus concurrently
            await Promise.all(oldMenus.map(source => {
                const idToDelete = source.knowledge_base_source_id || source.source_id || source.id;
                return deleteSource(idToDelete);
            }));

            // Wait a moment for Retell to process
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // C. Add New Menu
    await addTextSource(kbId, menuText);

    return true;
}

module.exports = { updateMenuInKB };
