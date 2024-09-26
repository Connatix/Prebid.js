import {
  registerBidder
} from '../src/adapters/bidderFactory.js';

import {
  deepAccess,
  isFn,
  logError,
  isArray,
  formatQS
} from '../src/utils.js';
import {getStorageManager} from '../src/storageManager.js';
import {
  BANNER,
} from '../src/mediaTypes.js';

const BIDDER_CODE = 'connatix';
const AD_URL = 'https://capi.connatix.com/rtb/hba';
const DEFAULT_MAX_TTL = '3600';
const DEFAULT_CURRENCY = 'USD';
const CNX_IDS = 'cnx_ids';
const CNX_ID_RETENTION_TIME_HOUR = 24 * 30; // 30 days
export const storage = getStorageManager({ bidderCode: BIDDER_CODE });

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

function saveOnAllStorages(name, value, expirationTimeHours) {
  const date = new Date();
  date.setTime(date.getTime() + (expirationTimeHours * 60 * 60 * 1000));
  const expires = `expires=${date.toUTCString()}`;
  storage.setCookie(name, value, expires);
  storage.setDataInLocalStorage(name, value);
}

function readFromAllStorages(name) {
  const fromCookie = storage.getCookie(name);
  const fromLocalStorage = storage.getDataFromLocalStorage(name);

  return fromCookie || fromLocalStorage || undefined;
}

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

    const cnxIds = readFromAllStorages(CNX_IDS);
    const requestPayload = {
      ortb2: bidderRequest.ortb2,
      gdprConsent: bidderRequest.gdprConsent,
      uspConsent: bidderRequest.uspConsent,
      gppConsent: bidderRequest.gppConsent,
      refererInfo: bidderRequest.refererInfo,
      userIds: cnxIds,
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
      mediaType: BANNER,
      netRevenue: true,
      width: bidResponse.Width,
      height: bidResponse.Height,
      creativeId: bidResponse.CreativeId,
      ad: bidResponse.Ad,
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

    window.addEventListener('message', function handler(event) {
      if (!event.data || !event.origin.includes('connatix')) {
        return;
      }
      this.removeEventListener('message', handler);

      event.stopImmediatePropagation();

      const response = event.data;
      if (!response.optout && response.eids) {
        saveOnAllStorages(CNX_IDS, response.eids, CNX_ID_RETENTION_TIME_HOUR);
      }
    }, true)

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
