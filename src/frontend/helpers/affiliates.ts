// Centralized affiliate-link handling for the (authorized) stores Heroic
// promotes. Each store gets a "strategy" describing how to turn a plain
// product/store URL into a tracked affiliate URL.
//
// Two strategies cover every program we use:
//
//  - 'param':    the store tracks via a query parameter (optionally on a
//                dedicated affiliate hostname). You can build the link
//                yourself on the client. GOG and Humble work this way.
//  - 'deeplink': the store is fronted by an affiliate network (Partnerize,
//                CJ, Admitad, ...). There is NO appendable parameter — the
//                destination URL must be wrapped in a network tracking link.
//                Paste that template here; {url} is the encoded destination.
//
// IMPORTANT: only authorized first-party stores / official resellers belong
// here. We deliberately do NOT integrate gray-market key resellers
// (G2A/Eneba/Gamivo): they undercut the same developers whose games run
// through Heroic and would damage the project's standing with the community
// and with the stores we depend on.

export type AffiliateStore = 'gog' | 'epic' | 'humble' | 'fanatical' | 'gmg'

interface ParamStrategy {
  kind: 'param'
  // Optional hostname rewrite. GOG only tracks links served from af.gog.com.
  hostname?: string
  // Query-parameter key the store reads for attribution.
  param: string
  // Your affiliate id / partner name / creator tag for that store.
  id: string
}

interface DeeplinkStrategy {
  kind: 'deeplink'
  // Network tracking template. `{url}` is replaced with the encoded target.
  template: string
}

type AffiliateStrategy = ParamStrategy | DeeplinkStrategy

// A `null` entry means "not configured yet" — withAffiliate() returns the
// original link untouched, so nothing breaks while you set the program up.
const AFFILIATES: Record<AffiliateStore, AffiliateStrategy | null> = {
  // GOG — already live. GOG only tracks links on the af.gog.com domain with
  // the original www.gog.com path preserved plus ?as=<id>.
  gog: {
    kind: 'param',
    hostname: 'af.gog.com',
    param: 'as',
    id: '1838482841'
  },

  // Humble Partner — simple appendable ?partner=<name> tag, works on store,
  // bundles and subscription URLs. Replace 'heroic' with the partner name
  // shown in the Humble Partner dashboard once approved.
  humble: {
    kind: 'param',
    param: 'partner',
    id: 'heroic' // TODO: confirm exact partner name in the Humble dashboard
  },

  // Epic Support-A-Creator. Epic generates a per-title "Creator Link" in the
  // SAC dashboard and/or attributes via a creator tag entered at checkout.
  // There is no officially documented appendable param, so leave this OFF
  // until you confirm the format from a real link generated in the dashboard
  // (https://sac.epicgames.com/). When you do, it is most likely:
  //   { kind: 'param', param: 'epic_creator_id', id: '<YOUR_CREATOR_TAG>' }
  epic: null,

  // Fanatical — runs through an affiliate network (Partnerize). No appendable
  // param: paste the deeplink template from the network dashboard.
  //   { kind: 'deeplink', template: 'https://prf.hn/click/.../dl/{url}' }
  fanatical: null,

  // Green Man Gaming — affiliate network (Admitad/Partnerize). Same as above.
  //   { kind: 'deeplink', template: 'https://<network>/g/<id>/?ulp={url}' }
  gmg: null
}

/**
 * Turn a plain store/product URL into a tracked affiliate URL for `store`.
 * Returns the original link unchanged if the store is unconfigured or the
 * input is not a valid URL — callers can use the result unconditionally.
 */
export const withAffiliate = (
  store: AffiliateStore,
  storeLink: string
): string => {
  const strategy = AFFILIATES[store]
  if (!strategy) return storeLink

  try {
    if (strategy.kind === 'param') {
      const url = new URL(storeLink)
      if (strategy.hostname) {
        url.hostname = strategy.hostname
      }
      url.searchParams.set(strategy.param, strategy.id)
      return url.toString()
    }

    // deeplink
    return strategy.template.replace('{url}', encodeURIComponent(storeLink))
  } catch {
    return storeLink
  }
}

/** Whether an affiliate program is configured (and thus monetizable) for a store. */
export const hasAffiliate = (store: AffiliateStore): boolean =>
  AFFILIATES[store] !== null
