import {
  registerBidder
} from '../src/adapters/bidderFactory.js';

import {
  deepAccess,
  isFn,
  logError,
  isArray,
  formatQS,
  getWindowSelf,
  getWindowTop,
  isNumber
} from '../src/utils.js';

import {
  ADPOD,
  BANNER,
  VIDEO,
} from '../src/mediaTypes.js';

const BIDDER_CODE = 'connatix';
const AD_URL = 'https://capi.connatix.com/rtb/hba';
const DEFAULT_MAX_TTL = '3600';
const DEFAULT_CURRENCY = 'USD';

/*
 * Get the bid floor value from the bid object, either using the getFloor function or by accessing the 'params.bidfloor' property.
 * If the bid floor cannot be determined, return 0 as a fallback value.
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

function validateBanner(mediaTypes) {
  if (!mediaTypes[BANNER]) {
    return true;
  }

  const banner = deepAccess(mediaTypes, BANNER, {});
  return (Boolean(banner.sizes) && isArray(mediaTypes[BANNER].sizes) && mediaTypes[BANNER].sizes.length > 0);
}

function validateVideo(mediaTypes) {
  const video = mediaTypes[VIDEO];
  if (!video) {
    return true;
  }

  return video.context !== ADPOD;
}

function _getMinSize(bidParamSizes) {
  return bidParamSizes.reduce((min, size) => size.h * size.w < min.h * min.w ? size : min)
}

function _isViewabilityMeasurable(element) {
  return !_isIframe() && element !== null;
}

function _isIframe() {
  try {
    return getWindowSelf() !== getWindowTop();
  } catch (e) {
    return true;
  }
}

function _getViewability(element, topWin, { w, h } = {}) {
  return topWin.document.visibilityState === 'visible'
    ? _getPercentInView(element, topWin, { w, h })
    : 0;
}

function _getPercentInView(element, topWin, { w, h } = {}) {
  const elementBoundingBox = _getBoundingBox(element, { w, h });

  const elementInViewBoundingBox = _getIntersectionOfRects([ {
    left: 0,
    top: 0,
    right: topWin.innerWidth,
    bottom: topWin.innerHeight
  }, elementBoundingBox ]);

  let elementInViewArea, elementTotalArea;

  if (elementInViewBoundingBox !== null) {
    elementInViewArea = elementInViewBoundingBox.width * elementInViewBoundingBox.height;
    elementTotalArea = elementBoundingBox.width * elementBoundingBox.height;

    return ((elementInViewArea / elementTotalArea) * 100);
  }

  return 0;
}

function _getBoundingBox(element, { w, h } = {}) {
  let { width, height, left, top, right, bottom } = element.getBoundingClientRect();

  if ((width === 0 || height === 0) && w && h) {
    width = w;
    height = h;
    right = left + w;
    bottom = top + h;
  }

  return { width, height, left, top, right, bottom };
}

function _getIntersectionOfRects(rects) {
  const bbox = {
    left: rects[0].left,
    right: rects[0].right,
    top: rects[0].top,
    bottom: rects[0].bottom
  };

  for (let i = 1; i < rects.length; ++i) {
    bbox.left = Math.max(bbox.left, rects[i].left);
    bbox.right = Math.min(bbox.right, rects[i].right);

    if (bbox.left >= bbox.right) {
      return null;
    }

    bbox.top = Math.max(bbox.top, rects[i].top);
    bbox.bottom = Math.min(bbox.bottom, rects[i].bottom);

    if (bbox.top >= bbox.bottom) {
      return null;
    }
  }

  bbox.width = bbox.right - bbox.left;
  bbox.height = bbox.bottom - bbox.top;

  return bbox;
}

export const spec = {
  code: BIDDER_CODE,
  gvlid: 143,
  supportedMediaTypes: [BANNER, VIDEO],

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

    const hasBidId = Boolean(bidId);
    const isValidBidder = (bidder === BIDDER_CODE);
    const hasMediaTypes = Boolean(mediaTypes) && (Boolean(mediaTypes[BANNER]) || Boolean(mediaTypes[VIDEO]));
    const isValidBanner = validateBanner(mediaTypes);
    const isValidVideo = validateVideo(mediaTypes);
    const isValidViewability = typeof params.viewabilityPercentage === 'undefined' || (isNumber(params.viewabilityPercentage) && params.viewabilityPercentage >= 0 && params.viewabilityPercentage <= 1);
    const hasRequiredBidParams = Boolean(params.placementId);

    const isValid = isValidBidder && hasBidId && hasMediaTypes && isValidViewability && isValidBanner && isValidVideo && hasRequiredBidParams;
    if (!isValid) {
      logError(
        `Invalid bid request: 
          isValidBidder: ${isValidBidder}, 
          hasBidId: ${hasBidId}, 
          hasMediaTypes: ${hasMediaTypes}, 
          isValidBanner: ${isValidBanner}, 
          isValidVideo: ${isValidVideo}, 
          hasRequiredBidParams: ${hasRequiredBidParams}`
      );
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
        adUnitCode
      } = bid;

      let detectedViewabilityPercentage = null;

      const element = document.getElementById(adUnitCode);
      // Get the sizes from the mediaTypes object if it exists, otherwise use the sizes array from the bid object
      // ??? Should we get also from w, h or make them required in our docs to improve the viewailbity detection support ???
      let bidParamSizes = bid.mediaTypes && bid.mediaTypes.banner && bid.mediaTypes.banner.sizes ? bid.mediaTypes.banner.sizes : bid.sizes;
      bidParamSizes = typeof bidParamSizes === 'undefined' && bid.mediaType && bid.mediaType.video && bid.mediaType.video.playerSize ? bid.mediaType.video.playerSize : bidParamSizes;
      bidParamSizes = typeof bidParamSizes === 'undefined' && bid.mediaType && bid.mediaType.video && isNumber(bid.mediaType.video.w) && isNumber(bid.mediaType.h) ? [bid.mediaType.video.w, bid.mediaType.video.h] : bidParamSizes;

      let minSize = _getMinSize(bidParamSizes ?? [])
      if (_isViewabilityMeasurable(element)) {
        const minSizeObj = {
          w: minSize[0],
          h: minSize[1]
        }
        detectedViewabilityPercentage = Math.round(_getViewability(element, getWindowTop(), minSizeObj))
      }

      return {
        bidId,
        mediaTypes,
        sizes,
        detectedViewabilityPercentage,
        declaredViewabilityPercentage: bid.params.viewabilityPercentage ?? null,
        placementId: params.placementId,
        floor: getBidFloor(bid),
      };
    });

    const requestPayload = {
      ortb2: bidderRequest.ortb2,
      gdprConsent: bidderRequest.gdprConsent,
      uspConsent: bidderRequest.uspConsent,
      gppConsent: bidderRequest.gppConsent,
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
   * relevant information such as requestId, cpm, ttl, width, height, creativeId, referrer and ad
   * Returns an array of bid responses by extracting and formatting the server response
   */
  interpretResponse: (serverResponse) => {
    const responseBody = serverResponse.body;
    const bids = responseBody.Bids;

    if (!isArray(bids)) {
      return [];
    }

    const referrer = responseBody.Referrer;
    return bids.map(bidResponse => ({
      requestId: bidResponse.RequestId,
      cpm: bidResponse.Cpm,
      ttl: bidResponse.Ttl || DEFAULT_MAX_TTL,
      currency: 'USD',
      mediaType: bidResponse.VastXml ? VIDEO : BANNER,
      netRevenue: true,
      width: bidResponse.Width,
      height: bidResponse.Height,
      creativeId: bidResponse.CreativeId,
      ad: bidResponse.Ad,
      vastXml: bidResponse.VastXml,
      referrer: referrer,
    }));
  },

  /*
   * Determine the user sync type (either 'iframe' or 'image') based on syncOptions.
   * Construct the sync URL by appending required query parameters such as gdpr, ccpa, and coppa consents.
   * Return an array containing an object with the sync type and the constructed URL.
   */
  getUserSyncs: (syncOptions, serverResponses, gdprConsent, uspConsent, gppConsent) => {
    if (!syncOptions.iframeEnabled) {
      return [];
    }

    if (!serverResponses || !serverResponses.length) {
      return [];
    }

    const params = {};

    if (gdprConsent) {
      if (typeof gdprConsent.gdprApplies === 'boolean') {
        params['gdpr'] = Number(gdprConsent.gdprApplies);
      } else {
        params['gdpr'] = 0;
      }

      if (typeof gdprConsent.consentString === 'string') {
        params['gdpr_consent'] = encodeURIComponent(gdprConsent.consentString);
      }
    }

    if (typeof uspConsent === 'string') {
      params['us_privacy'] = encodeURIComponent(uspConsent);
    }

    const syncUrl = serverResponses[0].body.UserSyncEndpoint;
    const queryParams = Object.keys(params).length > 0 ? formatQS(params) : '';

    const url = queryParams ? `${syncUrl}?${queryParams}` : syncUrl;
    return [{
      type: 'iframe',
      url
    }];
  }
};

registerBidder(spec);
