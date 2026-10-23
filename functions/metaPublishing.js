const DEFAULT_GRAPH_VERSION = "v24.0";

function cleanGraphVersion(value) {
  const version = String(value || DEFAULT_GRAPH_VERSION).trim();
  return /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION;
}

function graphBaseUrl(version) {
  return `https://graph.facebook.com/${cleanGraphVersion(version)}`;
}

async function graphRequest({ fetchImpl = fetch, version, path, accessToken, method = "POST", body, query }) {
  const url = new URL(`${graphBaseUrl(version)}/${String(path || "").replace(/^\/+/, "")}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || `Meta request failed (${response.status})`);
    error.status = response.status >= 400 && response.status < 500 ? 400 : 502;
    error.metaCode = data.error?.code || "";
    error.metaSubcode = data.error?.error_subcode || "";
    throw error;
  }
  return data;
}

function postCaption(post) {
  return String(post.content || "").trim();
}

async function publishFacebookPost(options) {
  const { pageId, accessToken, post } = options;
  if (!pageId || !accessToken) throw Object.assign(new Error("Facebook publishing is not configured"), { status: 503 });
  const caption = postCaption(post);
  if (!caption) throw Object.assign(new Error("Post content is required"), { status: 400 });
  const imageUrl = String(post.imageUrl || "").trim();
  const result = imageUrl
    ? await graphRequest({ ...options, path: `${pageId}/photos`, accessToken, body: { url: imageUrl, caption } })
    : await graphRequest({ ...options, path: `${pageId}/feed`, accessToken, body: { message: caption } });
  const postId = String(result.post_id || result.id || "");
  return {
    platform: "facebook",
    postId,
    mediaId: imageUrl ? String(result.id || "") : "",
    permalink: postId ? `https://www.facebook.com/${postId.replace("_", "/posts/")}` : "",
  };
}

async function publishInstagramPost(options) {
  const { instagramAccountId, accessToken, post } = options;
  if (!instagramAccountId || !accessToken) throw Object.assign(new Error("Instagram publishing is not configured"), { status: 503 });
  const caption = postCaption(post);
  const imageUrl = String(post.imageUrl || "").trim();
  if (!caption) throw Object.assign(new Error("Post content is required"), { status: 400 });
  if (!/^https:\/\//i.test(imageUrl)) throw Object.assign(new Error("Instagram posts require a public HTTPS image URL"), { status: 400 });
  const container = await graphRequest({ ...options, path: `${instagramAccountId}/media`, accessToken, body: { image_url: imageUrl, caption } });
  if (!container.id) throw Object.assign(new Error("Instagram did not return a media container"), { status: 502 });
  const published = await graphRequest({ ...options, path: `${instagramAccountId}/media_publish`, accessToken, body: { creation_id: container.id } });
  let permalink = "";
  if (published.id) {
    try {
      const details = await graphRequest({ ...options, method: "GET", path: published.id, accessToken, query: { fields: "permalink" } });
      permalink = String(details.permalink || "");
    } catch (_) {
      // Publishing succeeded; a permalink lookup failure must not turn it into a failed post.
    }
  }
  return { platform: "instagram", postId: String(published.id || ""), containerId: String(container.id), permalink };
}

async function publishMetaPost(options) {
  return options.post?.platform === "instagram"
    ? publishInstagramPost(options)
    : publishFacebookPost(options);
}

module.exports = {
  cleanGraphVersion,
  graphRequest,
  postCaption,
  publishFacebookPost,
  publishInstagramPost,
  publishMetaPost,
};
