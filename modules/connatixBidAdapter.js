import {
  deepAccess,
  isFn,
  logError,
  logMessage
} from '../src/utils.js';

import {
  registerBidder
} from '../src/adapters/bidderFactory.js';
import {
  config
} from '../src/config.js';
import {
  BANNER,
} from '../src/mediaTypes.js';

const BIDDER_CODE = 'connatix';
const AD_URL = 'https://placeholder.com/pbjs';
const SYNC_URL = 'https://placeholder.com/sync';
const DEFAULT_MAX_TTL = '3600';
const DEFAULT_CURRENCY = 'USD';

/* Get the bid floor value from the bid object,
  either using the getFloor function or by accessing the 'params.bidfloor' property.
  If the bid floor cannot be determined, return 0 as a fallback value.
*/
function getBidFloor(bid) {
  if (!isFn(bid.getFloor)) {
    return deepAccess(bid, 'params.bidfloor', 0);
  }

  try {
    const bidFloor = bid.getFloor({
      currency: DEFAULT_CURRENCY,
      mediaType: '*',
      size: '*',
    });
    return bidFloor.floor;
  } catch (err) {
    logError(err);
    return 0;
  }
}

/*  Wrap the provided bid, playerId, customerId, and scriptId in an HTML string
  that includes the Connatix player script and related data.
  This HTML string will be used as the ad content.
 */
function wrapAd(bid, playerId, customerId, scriptId, isInApp) {
  const scriptSrc = isInApp ? `'//cd.connatix.com/connatix.player.omid.js?cid=${customerId}'` : `'//cd.connatix.com/connatix.player.js?cid=${customerId}'`;
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title></title>
        <script>!function (n) { if (!window.cnx) { window.cnx = {}, window.cnx.cmd = []; var t = n.createElement('iframe'); t.src = 'javascript:false'; t.display = 'none', t.onload = function () { var n = t.contentWindow.document, c = n.createElement('script'); c.src = '${scriptSrc}', c.setAttribute('async', '1'), c.setAttribute('type', 'text/javascript'), n.body.appendChild(c) }, n.head.appendChild(t) } }(document);</script>
        <style>html, body {width: 100%; height: 100%; margin: 0;}</style>
    </head>
    <body>
    <script id="${scriptId}">(new Image()).src = 'https://capi.connatix.com/tr/si?token=${playerId}&cid=${customerId}'; cnx.cmd.push(function () {
      cnx({
          playerId: ${playerId},
          settings: ${bid.params.settings}
      }).render("${scriptId}");
  });</script>
    </body>
  </html>`;
}

export const spec = {
  code: BIDDER_CODE,
  gvlid: 143,
  supportedMediaTypes: [BANNER],

  /* Check if a bid request is valid by verifying if the bidId, params,
   and placementId properties are present,
   and if the mediaTypes object contains a BANNER object with a sizes property. */
  isBidRequestValid: (bid = {}) => {
    const {
      params,
      bidId,
      mediaTypes
    } = bid;
    if (!(bidId && params && params.placementId)) {
      return false;
    };

    return Boolean(mediaTypes[BANNER] && mediaTypes[BANNER].sizes);
  },

  /* Build the request payload by processing valid bid requests and extracting the necessary information.
  Determine the host and page from the bidderRequest's refferUrl, and include ccpa and gdpr consents.
  Return an object containing the request method, url, and the constructed payload. */
  buildRequests: (validBidRequests = [], bidderRequest = {}) => {
    const ccpa = bidderRequest.uspConsent || undefined;
    const gdpr = bidderRequest.gdprConsent || undefined;

    let refferLocation;
    try {
      refferLocation = bidderRequest.refferUrl && new URL(bidderRequest.refferUrl);
    } catch (e) {
      logMessage(e);
    }

    const host = refferLocation ? refferLocation.host : window.top.location.host;
    const page = refferLocation ? refferLocation.pathname : window.top.location.pathname;

    const bidRequests = validBidRequests.map(bid => {
      const {
        bidId,
        mediaTypes,
        params,
        sizes
      } = bid;
      return {
        bidId,
        sizes,
        mediaTypes,
        placementId: params.placementId,
        floor: getBidFloor(bid),
      };
    });

    const requestPayload = {
      host,
      page,
      bidRequests,
      ccpa,
      gdpr,
    }

    return {
      method: 'POST',
      url: AD_URL,
      data: requestPayload
    };
  },

  /* Interpret the server response and create an array of bid responses by extracting and formatting
  relevant information such as requestId, cpm, width, height, creativeId,
  and ad content (wrapped using the wrapAd function). */
  interpretResponse: (serverResponse) => {
    const bidResponses = serverResponse.body[0].bids.map(bidResponse => {
      return {
        requestId: bidResponse.bidId,
        cpm: bidResponse.cpm,
        width: bidResponse.width,
        height: bidResponse.height,
        creativeId: bidResponse.creativeId,
        // TODO: check if we'll get netRevenue from the server
        netRevenue: true,
        ttl: bidResponse.ttl || DEFAULT_MAX_TTL,
        referrer: bidResponse.referrer,
        ad: wrapAd(bidResponse.ad, bidResponse.width, bidResponse.height),
      };
    });

    return bidResponses;
  },

  /* Determine the user sync type (either 'iframe' or 'image') based on syncOptions.
   Construct the sync URL by appending required query parameters such as gdpr, ccpa, and coppa consents.
   Return an array containing an object with the sync type and the constructed URL. */
  getUserSyncs: (syncOptions, serverResponses, gdprConsent, uspConsent) => {
    let syncType = syncOptions.iframeEnabled ? 'iframe' : 'image';
    let syncUrl = SYNC_URL + `/${syncType}?pbjs=1`;
    if (gdprConsent && gdprConsent.consentString) {
      if (typeof gdprConsent.gdprApplies === 'boolean') {
        syncUrl += `&gdpr=${Number(gdprConsent.gdprApplies)}&gdpr_consent=${gdprConsent.consentString}`;
      } else {
        syncUrl += `&gdpr=0&gdpr_consent=${gdprConsent.consentString}`;
      }
    }
    if (uspConsent && uspConsent.consentString) {
      syncUrl += `&ccpa_consent=${uspConsent.consentString}`;
    }

    const coppa = config.getConfig('coppa') ? 1 : 0;
    syncUrl += `&coppa=${coppa}`;

    return [{
      type: syncType,
      url: syncUrl
    }];
  }

};

registerBidder(spec);
