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

import {
  BANNER,
} from '../src/mediaTypes.js';

const BIDDER_CODE = 'connatix';
const AD_URL = 'https://capi.connatix.com/rtb/hba';
const DEFAULT_MAX_TTL = '3600';
const DEFAULT_CURRENCY = 'USD';

export function wrapAd(lineItems, requestId, playerId, customerId) {
  var settings = {
    advertising: {
      standaloneLineItems: lineItems
    }
  };
  var scriptSrc = `//cd.connatix.com/connatix.player.js?cid=${customerId}`;
  var ad = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><script>!function(n){if(!window.cnx){window.cnx={},window.cnx.cmd=[];var t=n.createElement('iframe');t.src='javascript:false'; t.display='none',t.onload=function(){var n=t.contentWindow.document,c=n.createElement('script');c.src="${scriptSrc}",c.setAttribute('async','1'),c.setAttribute('type','text/javascript'),n.body.appendChild(c)},n.head.appendChild(t)}}(document);</script><style>html, body {width: 100%; height: 100%; margin: 0;}</style></head><body><script id="${requestId}">(new Image()).src = 'https://capi.connatix.com/tr/si?token=${playerId}&cid=${customerId}';  cnx.cmd.push(function() {    cnx({      playerId: "${playerId}", settings: ${JSON.stringify(settings)} }).render("${requestId}");  });</script></body></html>`;

  // Create an iframe element
  var iframe = document.createElement('iframe');
  // Set iframe attributes
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  // Add the iframe to the document or a specific container
  document.body.appendChild(iframe);
  // Get the iframe's document
  var doc = iframe.contentDocument || iframe.contentWindow.document;
  // Write the HTML string to the iframe document
  doc.open();
  doc.write(ad);
  doc.close();

  return ad;
};

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
   * relevant information such as requestId, cpm, ttl, width, height, creativeId, referrer and ad
   * Returns an array of bid responses by extracting and formatting the server response
   */
  interpretResponse: (serverResponse) => {
    const { PlayerId, CustomerId, Bids } = serverResponse.body;
    if (!PlayerId || !CustomerId || !Bids) {
      // eslint-disable-next-line no-template-curly-in-string
      var serverResponseJSONString = '{"body":{"PlayerId":"e4984e88-9ff4-45a3-8b9d-33aabcad634e","CustomerId":"99f20d18-c4b4-4a28-8d8e-d43e2c8cb4ac","Bids":[{"RequestId":"21cb54857820cd","Cpm":8,"Ttl":86400,"LineItems":[{"LineItem":{"PublisherLineItemId":"81199cb2-99c9-4b26-9b9a-37efe8821977","AdvertiserLineItemId":"d09815c9-6e65-43c8-984a-f4ad178ab5b5","Url":null,"Type":2,"RequireSoundOn":false,"RequireViewability":false,"RemoveOutOfFocus":false,"GdprvId":"12","Trackers":null,"Duration":0,"Renditions":null,"MediaCreativeId":null,"IgnoreFilledRequests":true,"RequestsCap":1,"ImpressionsCap":null,"Priority":1,"PbjsTimeout":1000,"MediaCreativeClickUrl":null,"RequestsCapTimeframe":0,"ImpressionsCapTimeframe":0,"CapType":0,"CreativeHlsFileName":null,"TimeBetweenRequests":null,"MediaTargeting":null,"MediaKeywordsTargeting":null,"MediaLanguageTargeting":null,"AdType":0,"OverlayTime":null,"FloorPrice":8,"DemandPartnerInfo":{"Name":"Beeswax","DealId":"Connatix-BPM-TheBlackTux-Weddings","BuyersId":null,"TagId":null,"PublisherId":null,"BaseDemandPartnerName":null,"ExcludePmpObject":false,"NetworkExpiryTime":86400},"AdBreakSettings":null,"OutOfViewPauseType":0,"MoatTrackingEnabled":false,"CreativeId":"7c8df0c1-ff37-42ab-8270-77286c330553","EnableVerticalAd":false,"BlockedDomainsRevisionNumber":null,"AdvertiserContextualTargeting":null,"PublisherContextualTargeting":null,"PlayerSizeTargetings":null,"AmazonDealId":null,"PlayerOrientationTargeting":0,"SkipMin":6,"Skippability":0,"AdOpportunityForceCalling":false,"NetworkExpiryTime":86400,"NonlinearLineItemSettings":null,"NewFloorPrices":{"FloorPrices":[],"Recommended":0},"PrebidParams":null,"IsPmp":true,"QueryJsTargeting":[],"AdxInfoModel":null,"IntentIQ":null,"GrossNetPercentageDifference":null,"IIQSource":"Beeswax"},"Bids":[{"WinNoticeUrl":null,"AdQualityCheckUrl":null,"Content":"<VAST version=\'3.0\'><Ad id=\'3919\'><Wrapper><Error><![CDATA[https://us-east-1.event.prod.bidr.io/log/vasterror?error_event=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGM8eIBQyA2N0eA==&error_code=[ERRORCODE]]]></Error><AdSystem>Beeswax</AdSystem><VASTAdTagURI><![CDATA[https://vast.extremereach.io/vast?line_item=15798525&subid1=novpaid&er_pm=&er_ar=0&us_privacy=${US_PRIVACY}&er_did=&ba_cb=385236447]]></VASTAdTagURI><Impression><![CDATA[https://us-east-1.event.prod.bidr.io/log/imp/ctx?sie=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggwD4oAWAAeM8egAEUkgEDY3R4oAHsgAOoAQDCAQDKAR9ibGlzc3BvaW50LTk1ODg3YTAxNDM0OWMzYWM4Y2Q10gEjQklEX1JFUVVFU1RfUExBVEZPUk1fREVWSUNFX1RZUEU6UEPaAQ4yMDIzMDYxNTA0MDAwMOIBHhIECAUQARIECAIQARIECAMQARIECAQQARIECAEQAeoBF2lwLjo6ZmZmZjoxOC4xOTAuMTU2LjEy-gEVDccSYj8SDvgEAQEAAAAAAAAAAAAA&wp=8&fie=IMA-ShAYgJvuAkIHYmVlc3dheEgBaggIARAAGAAgAHDAPooBEAoFCMA-EAERAAAAAAAA8D_yAQIYAA==&]]></Impression><Creatives><Creative><Linear><TrackingEvents><Tracking event=\'start\'><![CDATA[https://us-east-1.event.prod.bidr.io/log/act/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggAUDPHkgUUgNjdHhgAHoeEgQIARABEgQIAhABEgQIBBABEgQIAxABEgQIBRAB&]]></Tracking><Tracking event=\'firstQuartile\'><![CDATA[https://us-east-1.event.prod.bidr.io/log/act/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggAkDPHkgUUgNjdHhgAHoeEgQIARABEgQIAhABEgQIBBABEgQIAxABEgQIBRAB&]]></Tracking><Tracking event=\'midpoint\'><![CDATA[https://us-east-1.event.prod.bidr.io/log/act/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggA0DPHkgUUgNjdHhgAHoeEgQIARABEgQIAhABEgQIBBABEgQIAxABEgQIBRAB&]]></Tracking><Tracking event=\'thirdQuartile\'><![CDATA[https://us-east-1.event.prod.bidr.io/log/act/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggBEDPHkgUUgNjdHhgAHoeEgQIARABEgQIAhABEgQIBBABEgQIAxABEgQIBRAB&]]></Tracking><Tracking event=\'complete\'><![CDATA[https://us-east-1.event.prod.bidr.io/log/act/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggBUDPHkgUUgNjdHhgAHoeEgQIARABEgQIAhABEgQIBBABEgQIAxABEgQIBRAB&]]></Tracking><Tracking event=\'mute\'><![CDATA[https://us-east-1.event.prod.bidr.io/log/act/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggB0DPHkgUUgNjdHhgAHoeEgQIARABEgQIAhABEgQIBBABEgQIAxABEgQIBRAB&]]></Tracking><Tracking event=\'unmute\'><![CDATA[https://us-east-1.event.prod.bidr.io/log/act/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggCEDPHkgUUgNjdHhgAHoeEgQIARABEgQIAhABEgQIBBABEgQIAxABEgQIBRAB&]]></Tracking><Tracking event=\'pause\'><![CDATA[https://us-east-1.event.prod.bidr.io/log/act/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggCUDPHkgUUgNjdHhgAHoeEgQIARABEgQIAhABEgQIBBABEgQIAxABEgQIBRAB&]]></Tracking><Tracking event=\'resume\'><![CDATA[https://us-east-1.event.prod.bidr.io/log/act/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggCkDPHkgUUgNjdHhgAHoeEgQIARABEgQIAhABEgQIBBABEgQIAxABEgQIBRAB&]]></Tracking><Tracking event=\'fullscreen\'><![CDATA[https://us-east-1.event.prod.bidr.io/log/act/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggC0DPHkgUUgNjdHhgAHoeEgQIARABEgQIAhABEgQIBBABEgQIAxABEgQIBRAB&]]></Tracking><Tracking event=\'close\'><![CDATA[https://us-east-1.event.prod.bidr.io/log/act/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHggDEDPHkgUUgNjdHhgAHoeEgQIARABEgQIAhABEgQIBBABEgQIAxABEgQIBRAB&]]></Tracking></TrackingEvents><VideoClicks><ClickTracking><![CDATA[https://us-east-1.event.prod.bidr.io/log/clk/ctx?ai=ChIIiuCu7wUQrS4Yq4rz17bF_wISFAoKYmxpc3Nwb2ludBACGOERILchGgNjdHg4zx5AFEgBUgNjdHhgAHoeEgQIAhABEgQIBBABEgQIAxABEgQIBRABEgQIARAB&audit_flag_wp=8]]></ClickTracking></VideoClicks></Linear></Creative></Creatives><Extensions></Extensions></Wrapper></Ad></VAST>","EncryptedPrice":"BfD+jrjeEewG9y8zQrSv4hUvCpLcSj3F6DP5VC1LrBU=","CreativeId":"blisspoint-3919","SeatId":"beeswax","Adomain":"theblacktux.com","SyncedUser":false,"RequestedFloorPrice":8,"CampaignId":"2273","Width":0,"Height":0,"BillingNoticeUrls":[],"Mime":null,"BidPrice":-37,"DspId":null,"CnxBidId":"3e0c8f5c-6992-48b7-a603-14d5b962f217","LogAuctionInformation":false,"NumberOfBids":1,"NumberOfSeatBids":1,"RequestTime":32,"DealId":"Connatix-BPM-TheBlackTux-Weddings","AuctionType":1,"AuctionBidId":"CIrgru8FEK0uGKuK89e2xf8C","BidId":"beeswax/blisspoint","FloorPriceInformation":{"FloorPrices":[8],"FloorPriceIndexUsed":0,"FloorPriceFactorBypassReason":0,"AdxPredictedFloorPrice":null},"Discount":null,"LiveRamp":0,"ServerBillingNoticeUrls":null,"IIQData":{"EIDs":{},"ABGroup":0,"IIQUserSync":null}}]}]}]},"headers":{}}';
      serverResponse = JSON.parse(serverResponseJSONString);
    }

    const responseBody = serverResponse.body;
    const bids = responseBody.Bids;
    const playerId = responseBody.PlayerId;
    const customerId = responseBody.CustomerId;

    if (!isArray(bids) || !playerId || !customerId) {
      return [];
    }

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
      referrer: bidResponse.Referrer,
      ad: wrapAd(bidResponse.LineItems, bidResponse.RequestId, playerId, customerId)
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
