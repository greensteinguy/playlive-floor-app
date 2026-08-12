// Typed reads + subscriptions for the `linkRequests` top-level collection
// (Phase 6.2). Created only by the linkPlayerAccount Cloud Function; RESOLVED
// only through the resolveLinkRequest callable (custom claims need the admin
// SDK) — so this module deliberately exposes no update op.

import { LinkRequest } from '../schema'
import { validatedGet, validatedGetMany, subscribeToCollection } from './_client'
import { linkRequestPath, linkRequestsCollectionPath } from './_paths'

export function getLinkRequest(id) {
  return validatedGet(linkRequestPath(id), LinkRequest)
}

export function listLinkRequests(queryFn) {
  return validatedGetMany(linkRequestsCollectionPath(), LinkRequest, queryFn)
}

export function subscribeToLinkRequests(onUpdate, queryFn, onError) {
  return subscribeToCollection(linkRequestsCollectionPath(), LinkRequest, onUpdate, queryFn, onError)
}
