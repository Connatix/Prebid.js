import { isFn, deepAccess, logMessage, logError } from '../src/utils.js';
import { convertOrtbRequestToProprietaryNative } from '../src/native.js';

import { registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER, NATIVE, VIDEO } from '../src/mediaTypes.js';
import { config } from '../src/config.js';

const BIDDER_CODE = 'connatix';
const AD_URL = 'http://wuttudu.com/pbjs';
const SYNC_URL = 'http://cs.connatix.com';

let requestId = '';

function isBidResponseValid(bid) {
  if (!bid.cpm || !bid.creativeId || !bid.ttl || !bid.currency) {
    return false;
  }

  switch (bid.mediaType) {
    case BANNER:
      return Boolean(bid.width && bid.height && bid.ad);
    default:
      return false;
  }
}

function getPlacementReqData(bid) {
  const { params, bidId, mediaTypes } = bid;
  const schain = bid.schain || {};
  const { placementId } = params;
  const bidfloor = getBidFloor(bid);

  const placement = {
    bidId,
    schain,
    bidfloor
  };

  placement.placementId = placementId;
  placement.type = 'publisher';

  if (mediaTypes && mediaTypes[BANNER]) {
    placement.adFormat = BANNER;
    placement.sizes = mediaTypes[BANNER].sizes;
  }

  return placement;
}

function getBidFloor(bid) {
  if (!isFn(bid.getFloor)) {
    return deepAccess(bid, 'params.bidfloor', 0);
  }

  try {
    const bidFloor = bid.getFloor({
      currency: 'USD',
      mediaType: '*',
      size: '*',
    });
    return bidFloor.floor;
  } catch (err) {
    logError(err);
    return 0;
  }
}

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER, VIDEO, NATIVE],

  isBidRequestValid: (bid = {}) => {
    const { params, bidId, mediaTypes } = bid;
    let valid = Boolean(bidId && params && params.placementId);

    if (mediaTypes && mediaTypes[BANNER]) {
      valid = valid && Boolean(mediaTypes[BANNER] && mediaTypes[BANNER].sizes);
    }

    return valid;
  },

  buildRequests: (validBidRequests = [], bidderRequest = {}) => {
    // convert Native ORTB definition to old-style prebid native definition
    validBidRequests = convertOrtbRequestToProprietaryNative(validBidRequests);
    console.log(validBidRequests,bidderRequest);
    requestId = bidderRequest.bids[0].bidId;
    let deviceWidth = 0;
    let deviceHeight = 0;

    let winLocation;
    try {
      const winTop = window.top;
      deviceWidth = winTop.screen.width;
      deviceHeight = winTop.screen.height;
      winLocation = winTop.location;
    } catch (e) {
      logMessage(e);
      winLocation = window.location;
    }

    const refferUrl = bidderRequest.refererInfo && bidderRequest.refererInfo.page;
    let refferLocation;
    try {
      refferLocation = refferUrl && new URL(refferUrl);
    } catch (e) {
      logMessage(e);
    }
    // TODO: does the fallback make sense here?
    let location = refferLocation || winLocation;
    const language = (navigator && navigator.language) ? navigator.language.split('-')[0] : '';
    const host = location.host;
    const page = location.pathname;
    const secure = location.protocol === 'https:' ? 1 : 0;
    const placements = [];
    const request = {
      deviceWidth,
      deviceHeight,
      language,
      secure,
      host,
      page,
      placements,
      coppa: config.getConfig('coppa') === true ? 1 : 0,
      ccpa: bidderRequest.uspConsent || undefined,
      gdpr: bidderRequest.gdprConsent || undefined,
      tmax: config.getConfig('bidderTimeout')
    };

    const len = validBidRequests.length;
    for (let i = 0; i < len; i++) {
      const bid = validBidRequests[i];
      placements.push(getPlacementReqData(bid));
    }
    console.log(request);
    return {
      method: 'POST',
      url: AD_URL,
      data: request
    };
  },

  interpretResponse: (serverResponse) => {
    let response = [];
    console.log(serverResponse);
    serverResponse.body[0].requestId = requestId;
    for (let i = 0; i < serverResponse.body.length; i++) {
      let resItem = serverResponse.body[i];
      if (isBidResponseValid(resItem)) {
        const advertiserDomains = resItem.adomain && resItem.adomain.length ? resItem.adomain : [];
        resItem.meta = { ...resItem.meta, advertiserDomains };
        resItem.netRevenue = false;
        resItem.ad = wrapAd(resItem);
        response.push(resItem);
      }
    }
    console.log(response);
    return response;
  },

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

function wrapAd(bid) {
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title></title>
        <script src="https://st.astraone.io/prebidrenderer.js"></script>
        <style>html, body {width: 100%; height: 100%; margin: 0;}</style>
    </head>
    <body>
        <div data-hyb-ssp-in-image-overlay="test" style="width: 100%; height: 100%;"></div>
        <script>
            if (parent.window.frames[window.name]) {
                var parentDocument = window.parent.document.getElementById(parent.window.frames[window.name].name);
                parentDocument.style.height = "100%";
                parentDocument.style.width = "100%";
            }
            var _html = "${encodeURIComponent(JSON.stringify({...bid}))}";
            window._ao_ssp.registerInImage(JSON.parse(decodeURIComponent(_html)));
        </script>
    </body>
  </html>`;
}

registerBidder(spec);
