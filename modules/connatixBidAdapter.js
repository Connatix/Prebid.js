import {
  deepAccess,
  isFn,
  logError,
  isArray
} from '../src/utils.js';

import {
  registerBidder
} from '../src/adapters/bidderFactory.js';
import {
  BANNER,
} from '../src/mediaTypes.js';

const BIDDER_CODE = 'connatix';
const AD_URL = 'https://capi.connatix.com/rtb/hba';
const DEFAULT_MAX_TTL = '3600';
const DEFAULT_CURRENCY = 'USD';

/*
   * Get the bid floor value from the bid object, either using the getFloor function or by accessing the 'params.bidfloor' property.
   * If the bid floor cannot be determined, return 0 as a fallback value.
   */
export function getBidFloor(bid) {
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

/*
   * Wrap the provided bid, playerId, customerId, and scriptId in an HTML string
   * that includes the Connatix player script and related data.
   * This HTML string will be used as the ad content.
   */
export function wrapAd(lineItems, requestId, playerId, customerId) {
  var settings = {
    advertising: {
      standaloneLineItems: lineItems
    }
  };
  var scriptSrc = `//cd.connatix.com/connatix.player.js?cid=${customerId}`;
  return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <title></title>
          <script>!function(n){if(!window.cnx){window.cnx={},window.cnx.cmd=[];var t=n.createElement('iframe');t.src='javascript:false'; t.display='none',t.onload=function(){var n=t.contentWindow.document,c=n.createElement('script');c.src="${scriptSrc}",c.setAttribute('async','1'),c.setAttribute('type','text/javascript'),n.body.appendChild(c)},n.head.appendChild(t)}}(document);</script>
          <style>html, body {width: 100%; height: 100%; margin: 0;}</style>
      </head>
      <body>
        <script id="${requestId}">(new Image()).src = 'https://capi.connatix.com/tr/si?token=${playerId}&cid=${customerId}';  cnx.cmd.push(function() {    cnx({      playerId: "${playerId}", settings: ${JSON.stringify(settings)} }).render("${requestId}");  });</script>
      </body>
    </html>`;
};

export const spec = {
  code: BIDDER_CODE,
  gvlid: 143,
  supportedMediaTypes: [BANNER],

  /*
     * Validate the bid request.
     * If the request is valid, Connatix is trying to obtain at least one bid.
     * Otherwise, the request to the Connatix server is not made
     */
  isBidRequestValid: (bid = {}) => {
    const bidId = deepAccess(bid, 'bidId');
    const mediaTypes = deepAccess(bid, 'mediaTypes', {});
    const params = deepAccess(bid, 'params', {});
    const bidder = deepAccess(bid, 'bidder');

    const banner = deepAccess(mediaTypes, BANNER, {});

    const hasBidId = Boolean(bidId);
    const isValidBidder = (bidder === BIDDER_CODE);
    const isValidSize = (Boolean(banner.sizes) && isArray(mediaTypes[BANNER].sizes) && mediaTypes[BANNER].sizes.length > 0);
    const hasSizes = mediaTypes[BANNER] ? isValidSize : false;
    const hasRequiredBidParams = Boolean(params.placementId);

    const isValid = isValidBidder && hasBidId && hasSizes && hasRequiredBidParams;
    if (!isValid) {
      logError(`Invalid bid request: isValidBidder: ${isValidBidder} hasBidId: ${hasBidId}, hasSizes: ${hasSizes}, hasRequiredBidParams: ${hasRequiredBidParams}`);
    }
    return isValid;
  },

  /*
     * Build the request payload by processing valid bid requests and extracting the necessary information.
     * Determine the host and page from the bidderRequest's refferUrl, and include ccpa and gdpr consents.
     * Return an object containing the request method, url, and the constructed payload.
     */
  buildRequests: (validBidRequests = [], bidderRequest = {}) => {
    const bidRequests = validBidRequests.map(bid => {
      const {
        bidId,
        mediaTypes,
        params,
        sizes,
      } = bid;
      return {
        bidId,
        mediaTypes,
        sizes,
        placementId: params.placementId,
        floor: getBidFloor(bid),
      };
    });

    const requestPayload = {
      ortb2: bidderRequest.ortb2,
      gdprConsent: bidderRequest.gdprConsent,
      uspConsent: bidderRequest.uspConsent,
      refererInfo: bidderRequest.refererInfo,
      bidRequests,
    };

    return {
      method: 'POST',
      url: AD_URL,
      data: requestPayload
    };
  },

  /*
     * Interpret the server response and create an array of bid responses by extracting and formatting
     * relevant information such as requestId, cpm, width, height, creativeId,
     * and ad content (wrapped using the wrapAd function).
     * Returns an array of bid responses by extracting and formatting the server response
     */
  interpretResponse: (serverResponse) => {
    const responseBody = serverResponse.body;
    const bids = responseBody.Bids;
    const playerId = responseBody.PlayerId;
    const customerId = responseBody.CustomerId;

    if (!isArray(bids) || !playerId || !customerId) {
      return [];
    }

    const bidResponses = bids.map(bidResponse => ({
      requestId: bidResponse.RequestId,
      cpm: bidResponse.Cpm,
      ttl: bidResponse.Ttl || DEFAULT_MAX_TTL,
      currency: 'USD',
      mediaType: BANNER,
      netRevenue: true,
      width: bidResponse.Width,
      height: bidResponse.Height,
      creativeId: bidResponse.CreativeId,
      referrer: bidResponse.Referrer,
      ad: wrapAd(bidResponse.LineItems, bidResponse.RequestId, playerId, customerId),
    }));

    return bidResponses;
  },

  /*
     * Determine the user sync type (either 'iframe' or 'image') based on syncOptions.
     * Construct the sync URL by appending required query parameters such as gdpr, ccpa, and coppa consents.
     * Return an array containing an object with the sync type and the constructed URL.
     * NOTE: We don't do user sync for now
     */
  getUserSyncs: (syncOptions, serverResponses, gdprConsent, uspConsent, gppConsent) => {
    return [];
  }
};

registerBidder(spec);
