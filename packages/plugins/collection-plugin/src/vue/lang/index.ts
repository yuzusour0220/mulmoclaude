// The collection plugin's OWN vue-i18n instance — fully self-contained, sharing
// no i18n resources with the host. Components call `useT()` (the `t` function)
// and `useLocale()` instead of vue-i18n's `useI18n()`, so the keys
// (`collectionsView.*`, `common.*`) stay identical — only the source changes.
//
// The active locale is fed through the CollectionUi binding (`localeTag()`), not
// gui-chat-protocol's PLUGIN_RUNTIME_KEY: the collection pages mount both inside
// chat (where the runtime exists) AND on standalone routes (where it doesn't),
// and the binding is available in both. One detached, app-lifetime effect keeps
// this instance's locale in step with the host's.

import { createI18n } from "vue-i18n";
import { effectScope, watchEffect } from "vue";
import { collectionUi } from "../uiContext";
import enMessages, { type CollectionMessages } from "./en";
import jaMessages from "./ja";
import zhMessages from "./zh";
import koMessages from "./ko";
import esMessages from "./es";
import ptBRMessages from "./ptBR";
import frMessages from "./fr";
import deMessages from "./de";

const i18n = createI18n<[CollectionMessages], string, false>({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: {
    en: enMessages,
    ja: jaMessages,
    zh: zhMessages,
    ko: koMessages,
    es: esMessages,
    "pt-BR": ptBRMessages,
    fr: frMessages,
    de: deMessages,
  },
});

const syncScope = effectScope(true);
let syncing = false;

/** Mirror this instance's locale to the host's (via the binding) exactly once,
 *  in a detached effect so it lives for the app's lifetime rather than a single
 *  component's. Called lazily on the first `useT()` — by then App.vue's setup has
 *  configured the binding, so `collectionUi()` resolves. */
function ensureLocaleSync(): void {
  if (syncing) return;
  // Flip the flag only after the effect is wired — if the first locale read
  // throws (e.g. the binding isn't configured yet), a later call can retry
  // rather than being locked out forever.
  syncScope.run(() => {
    watchEffect(() => {
      i18n.global.locale.value = collectionUi().localeTag();
    });
  });
  syncing = true;
}

/** The plugin's i18n composable — a drop-in for vue-i18n's `useI18n()` over the
 *  plugin's own self-contained instance. Returns `{ t, locale }` (destructured at
 *  the call site, exactly like `useI18n()`), with `t` reading the plugin's keys
 *  and `locale` the reactive tag for date/number formatting. */
export function useCollectionI18n(): { t: (typeof i18n.global)["t"]; locale: (typeof i18n.global)["locale"] } {
  ensureLocaleSync();
  return { t: i18n.global.t, locale: i18n.global.locale };
}
