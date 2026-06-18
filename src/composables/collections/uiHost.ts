// Wire @mulmoclaude/collection-plugin/vue to MulmoClaude's collection REST API +
// asset-URL scheme. Imported for side effect at app startup (src/main.ts) so the
// package's rendering composable can resolve ref/embed data and file/asset URLs.
// MulmoTerminal has its own equivalent shim.
import { configureCollectionUi, type CollectionViewToken } from "@mulmoclaude/collection-plugin/vue";
// The package's compiled Tailwind classes — the library build extracts the
// SFCs' styles into this file rather than injecting them, and node_modules isn't
// in this host's Tailwind content scan, so the classes the collection components
// use must be loaded explicitly here.
import "@mulmoclaude/collection-plugin/style.css";
import { apiDelete, apiFetchRaw, apiGet, apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { htmlPreviewUrlFor, svgPreviewUrlFor } from "../useContentDisplay";
import { isValidFilePath } from "../useFileSelection";
import { resolveImageSrc } from "../../utils/image/resolve";
import { buildCustomViewSrcdoc } from "../../utils/html/customViewSrcdoc";
import { useConfirm } from "../useConfirm";
import type { CollectionDetailResponse } from "../../components/collectionTypes";

const { openConfirm } = useConfirm();

const withSlug = (route: string, slug: string): string => route.replace(":slug", encodeURIComponent(slug));
const viewDeleteUrl = (slug: string, viewId: string): string =>
  withSlug(API_ROUTES.collections.viewDelete, slug).replace(":viewId", encodeURIComponent(viewId));

configureCollectionUi({
  fetchCollectionDetail: (slug) => apiGet<CollectionDetailResponse>(withSlug(API_ROUTES.collections.detail, slug)),
  fileAssetUrl: (value) => (isValidFilePath(value) ? (htmlPreviewUrlFor(value) ?? svgPreviewUrlFor(value)) : null),
  fileRoutePath: (value) => (isValidFilePath(value) ? `/files/${value.split("/").map(encodeURIComponent).join("/")}` : null),
  imageSrc: (imageData) => resolveImageSrc(imageData),
  confirm: (options) => openConfirm(options),
  deleteView: (slug, viewId) => apiDelete(viewDeleteUrl(slug, viewId)),
  mintViewToken: (slug, viewId) => apiPost<CollectionViewToken>(withSlug(API_ROUTES.collections.viewToken, slug), { viewId }),
  fetchViewHtml: async (slug, viewId) => {
    const resp = await apiFetchRaw(withSlug(API_ROUTES.collections.viewFile, slug), { query: { id: viewId } });
    return resp.ok ? { ok: true, html: await resp.text() } : { ok: false, status: resp.status };
  },
  buildViewSrcdoc: (html, boot) => buildCustomViewSrcdoc(html, boot),
});
