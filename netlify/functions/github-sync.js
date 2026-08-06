exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method not allowed' };
  }
  try {
    const GH_TOKEN = process.env.GH_TOKEN;
    if (!GH_TOKEN) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'GH_TOKEN not configured' }) };
    }
    const { action, content, sha, message, path } = JSON.parse(event.body);
    const repo = 'mtsi-lgtm/mtsi-website';
    const ghHeaders = {
      'Authorization': 'token ' + GH_TOKEN,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'mtsi-netlify-function'
    };
    if (action === 'get') {
      const res = await fetch('https://api.github.com/repos/' + repo + '/contents/index.html', { headers: ghHeaders });
      const data = await res.json();
      if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };
      let fileContent = data.content;
      // Contents API returns empty content for files over 1MB; fetch the blob instead
      if (!fileContent) {
        const blobRes = await fetch('https://api.github.com/repos/' + repo + '/git/blobs/' + data.sha, { headers: ghHeaders });
        const blobData = await blobRes.json();
        if (!blobRes.ok) return { statusCode: blobRes.status, headers, body: JSON.stringify(blobData) };
        fileContent = blobData.content;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ sha: data.sha, content: fileContent }) };
    }
    if (action === 'put') {
      const res = await fetch('https://api.github.com/repos/' + repo + '/contents/index.html', {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify({ message: message || 'Update site via admin', content, sha })
      });
      const data = await res.json();
      if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, sha: data.content.sha }) };
    }
    if (action === 'put-file') {
      // Commit an image as a separate file. Restricted to the images/ folder.
      if (!path || !/^images\/[A-Za-z0-9._-]{1,100}$/.test(path) || path.indexOf('..') !== -1) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid path' }) };
      }
      const fileUrl = 'https://api.github.com/repos/' + repo + '/contents/' + path;
      let existingSha;
      const check = await fetch(fileUrl, { headers: ghHeaders });
      if (check.ok) existingSha = (await check.json()).sha;
      const putBody = { message: message || 'Upload image via admin', content };
      if (existingSha) putBody.sha = existingSha;
      const res = await fetch(fileUrl, { method: 'PUT', headers: ghHeaders, body: JSON.stringify(putBody) });
      const data = await res.json();
      if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, path: path, sha: data.content.sha }) };
    }
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
