const PAGE_ID = '3359af525ae280c78957dea10e5b627d';

export const handler = async () => {
  const token = process.env.NOTION_TOKEN;

  if (!token) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'NOTION_TOKEN environment variable is not set.' }),
    };
  }

  const notionHeaders = {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    // Fetch page metadata (for title)
    const [pageRes, blocksRes] = await Promise.all([
      fetch(`https://api.notion.com/v1/pages/${PAGE_ID}`, { headers: notionHeaders }),
      fetch(`https://api.notion.com/v1/blocks/${PAGE_ID}/children?page_size=100`, { headers: notionHeaders }),
    ]);

    const pageData = await pageRes.json();
    const blocksData = await blocksRes.json();

    if (!blocksRes.ok) {
      return {
        statusCode: blocksRes.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: blocksData.message || 'Failed to fetch Notion blocks.' }),
      };
    }

    // Extract title from page properties
    let title = 'Important information';
    const titleProp = pageData?.properties?.title?.title;
    if (titleProp && titleProp.length > 0) {
      title = titleProp.map(t => t.plain_text).join('');
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        title,
        blocks: blocksData.results || [],
        last_fetched: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
