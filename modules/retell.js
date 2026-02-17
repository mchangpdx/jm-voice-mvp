/* modules/retell.js - Official SDK Version */
const Retell = require('retell-sdk');
require('dotenv').config();

const API_KEY = process.env.RETELL_API_KEY;

// Initialize SDK Client
const client = new Retell({
    apiKey: API_KEY,
});

// 1. Get KB Info (Retrieve)
async function getKnowledgeBase(kbId) {
    try {
        // console.log(`[Retell SDK] Fetching KB: ${kbId}`);
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

// 3. Add Text Source (Using SDK)
async function addTextSource(kbId, menuText) {
    try {
        const now = new Date();
        const timeString = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${now.getHours()}h${now.getMinutes()}m`;
        const uniqueTitle = `Daily Menu ${timeString}`;

        console.log(`[Retell SDK] Adding source: "${uniqueTitle}"`);

        // SDK handles the multipart/form-data complexity automatically
        const response = await client.knowledgeBase.addSources(kbId, {
            knowledge_base_texts: [
                {
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

// Main Logic (Smart Update)
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell SDK] Starting Menu Update...');

    // A. Fetch Current Sources
    const kbData = await getKnowledgeBase(kbId);

    // B. Smart Delete: Only delete items with "Daily Menu" in title
    if (kbData.knowledge_base_sources) {
        const oldMenus = kbData.knowledge_base_sources.filter(source =>
            source.title && source.title.includes("Daily Menu")
        );

        if (oldMenus.length > 0) {
            console.log(`[Retell SDK] Found ${oldMenus.length} old menu(s). Cleaning up...`);
            // Use Promise.all for faster parallel deletion
            await Promise.all(oldMenus.map(source =>
                deleteSource(kbId, source.knowledge_base_source_id)
            ));

            // Short safety delay
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // C. Add New Menu
    await addTextSource(kbId, menuText);

    return true;
}

module.exports = { updateMenuInKB };
