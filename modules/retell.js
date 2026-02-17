/* modules/retell.js - Fixed SDK Payload */
const Retell = require('retell-sdk');
require('dotenv').config();

const API_KEY = process.env.RETELL_API_KEY;

// Initialize SDK
const client = new Retell({
    apiKey: API_KEY,
});

// 1. Get KB Info
async function getKnowledgeBase(kbId) {
    try {
        const response = await client.knowledgeBase.retrieve(kbId);
        return response;
    } catch (error) {
        console.error(`[Retell SDK] Get Error: ${error.message}`);
        throw error;
    }
}

// 2. Delete Source
async function deleteSource(kbId, sourceId) {
    try {
        console.log(`[Retell SDK] Deleting source: ${sourceId}`);
        await client.knowledgeBase.deleteSource(kbId, sourceId);
    } catch (error) {
        console.warn(`[Retell SDK] Delete Warning: ${error.message}`);
    }
}

// 3. Add Text Source (FIXED KEY)
async function addTextSource(kbId, menuText) {
    try {
        const now = new Date();
        const timeString = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${now.getHours()}h${now.getMinutes()}m`;
        const uniqueTitle = `Daily Menu ${timeString}`;

        console.log(`[Retell SDK] Adding source: "${uniqueTitle}"`);

        // [CRITICAL FIX] Use 'knowledge_base_sources' key with 'type: "text"'
        const response = await client.knowledgeBase.addSources(kbId, {
            knowledge_base_sources: [
                {
                    type: "text", // Required
                    title: uniqueTitle,
                    text: menuText
                }
            ]
        });

        console.log(`[Retell SDK] Success! Added new source.`);
        return response;
    } catch (error) {
        console.error(`[Retell SDK] Add Error: ${error.message}`);
        throw error;
    }
}

// Main Logic
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell SDK] Starting Menu Update...');

    // A. Fetch Current Sources
    const kbData = await getKnowledgeBase(kbId);

    // B. Smart Delete
    if (kbData.knowledge_base_sources) {
        const oldMenus = kbData.knowledge_base_sources.filter(source =>
            source.title && source.title.includes("Daily Menu")
        );

        if (oldMenus.length > 0) {
            console.log(`[Retell SDK] Found ${oldMenus.length} old menu(s). Cleaning up...`);
            await Promise.all(oldMenus.map(source =>
                deleteSource(kbId, source.knowledge_base_source_id)
            ));
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // C. Add New Menu
    await addTextSource(kbId, menuText);

    return true;
}

module.exports = { updateMenuInKB };
