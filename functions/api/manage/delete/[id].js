import { jsonResponse } from "../../../utils/http.js";
import { getMetadata } from "../../../utils/metadata.js";
import { deleteShortLink } from "../../../utils/shortlink.js";
import { getMetadataStore } from "../../../utils/metadata-store.js";

export async function onRequest(context) {
    const { env, params } = context;

    const metadata = await getMetadata(env, params.id);
    await getMetadataStore(env).delete(params.id);

    if (metadata?.shortId) {
        await deleteShortLink(env, metadata.shortId);
    }

    return jsonResponse(params.id);
}
