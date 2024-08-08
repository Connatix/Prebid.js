import { expect } from 'chai';
import {
  spec,
  getBidFloor as connatixGetBidFloor
} from '../../../modules/connatixBidAdapter.js';
import { ADPOD, BANNER, VIDEO } from '../../../src/mediaTypes.js';

describe('connatixBidAdapter', function () {
  let bid;

  function mockBidRequest() {
    const mediaTypes = {
      banner: {
        sizes: [16, 9],
      }
    };
    return {
      bidId: 'testing',
      bidder: 'connatix',
      params: {
        placementId: '30e91414-545c-4f45-a950-0bec9308ff22'
      },
      mediaTypes
    };
  };

  function addVideoToBidMock(bid) {
    const mediaTypes = {
      video: {
        context: 'instream',
        w: 1280,
        h: 720,
        playerSize: [1280, 720],
        placement: 1,
        plcmt: 1,
        api: [1, 2],
        mimes: ['video/mp4', 'application/javascript'],
        minduration: 30,
        maxduration: 60,
        startdelay: 0,
      }
    }

    bid.mediaTypes = mediaTypes;
  }

  describe('_getMinSize', () => {
    test('should return the smallest size based on area', () => {
      const sizes = [
        { w: 300, h: 250 },
        { w: 728, h: 90 },
        { w: 160, h: 600 }
      ];
      const result = _getMinSize(sizes);
      expect(result).toEqual({ w: 300, h: 250 }); // smallest area is 300 * 250
    });

    test('should handle an array with one size', () => {
      const sizes = [{ w: 300, h: 250 }];
      const result = _getMinSize(sizes);
      expect(result).toEqual({ w: 300, h: 250 });
    });

    test('should handle empty array', () => {
      const sizes = [];
      const result = _getMinSize(sizes);
      expect(result).toBeUndefined();
    });
  });

  describe('_isViewabilityMeasurable', () => {
    test('should return false if element is null', () => {
      const result = _isViewabilityMeasurable(null);
      expect(result).toBe(false);
    });

    test('should return true if element is not null and not in an iframe', () => {
      const mockElement = {}; // Mock element
      const result = _isViewabilityMeasurable(mockElement);
      expect(result).toBe(true);
    });

    test('should return false if inside an iframe', () => {
      // Mock the _isIframe function to return true
      jest.spyOn(global, '_isIframe').mockReturnValue(true);

      const mockElement = {}; // Mock element
      const result = _isViewabilityMeasurable(mockElement);
      expect(result).toBe(false);

      // Restore the original implementation
      global._isIframe.mockRestore();
    });
  });

  describe('_isIframe', () => {
    test('should return true if in an iframe', () => {
      jest.spyOn(global, 'getWindowSelf').mockReturnValue({ location: 'http://test.com' });
      jest.spyOn(global, 'getWindowTop').mockReturnValue({ location: 'http://other.com' });

      const result = _isIframe();
      expect(result).toBe(true);

      global.getWindowSelf.mockRestore();
      global.getWindowTop.mockRestore();
    });

    test('should return false if not in an iframe', () => {
      jest.spyOn(global, 'getWindowSelf').mockReturnValue({ location: 'http://test.com' });
      jest.spyOn(global, 'getWindowTop').mockReturnValue({ location: 'http://test.com' });

      const result = _isIframe();
      expect(result).toBe(false);

      global.getWindowSelf.mockRestore();
      global.getWindowTop.mockRestore();
    });

    test('should return true if an error is thrown', () => {
      jest.spyOn(global, 'getWindowSelf').mockImplementation(() => {
        throw new Error('Security error');
      });

      const result = _isIframe();
      expect(result).toBe(true);

      global.getWindowSelf.mockRestore();
    });
  });

  describe('_getViewability', () => {
    test('should return 0 if the document is not visible', () => {
      const mockTopWin = { document: { visibilityState: 'hidden' } };
      const mockElement = {};

      const result = _getViewability(mockElement, mockTopWin, { w: 300, h: 250 });
      expect(result).toBe(0);
    });

    test('should calculate viewability when the document is visible', () => {
      const mockTopWin = {
        document: { visibilityState: 'visible' },
        innerWidth: 1000,
        innerHeight: 800
      };
      const mockElement = {
        getBoundingClientRect: () => ({
          width: 300,
          height: 250,
          left: 100,
          top: 100,
          right: 400,
          bottom: 350
        })
      };

      jest.spyOn(global, '_getPercentInView').mockReturnValue(50);

      const result = _getViewability(mockElement, mockTopWin, { w: 300, h: 250 });
      expect(result).toBe(50);

      global._getPercentInView.mockRestore();
    });
  });

  describe('_getPercentInView', () => {
    test('should return 0 if element is not in view', () => {
      const mockTopWin = {
        innerWidth: 1000,
        innerHeight: 800
      };
      const mockElement = {
        getBoundingClientRect: () => ({
          width: 300,
          height: 250,
          left: 1200, // Out of viewport
          top: 100,
          right: 1500,
          bottom: 350
        })
      };

      const result = _getPercentInView(mockElement, mockTopWin, { w: 300, h: 250 });
      expect(result).toBe(0);
    });

    test('should calculate percent in view correctly', () => {
      const mockTopWin = {
        innerWidth: 1000,
        innerHeight: 800
      };
      const mockElement = {
        getBoundingClientRect: () => ({
          width: 300,
          height: 250,
          left: 100,
          top: 100,
          right: 400,
          bottom: 350
        })
      };

      const result = _getPercentInView(mockElement, mockTopWin, { w: 300, h: 250 });
      expect(result).toBeCloseTo(100); // Element fully in view
    });

    test('should handle partial visibility', () => {
      const mockTopWin = {
        innerWidth: 500,
        innerHeight: 800
      };
      const mockElement = {
        getBoundingClientRect: () => ({
          width: 600,
          height: 250,
          left: 0,
          top: 100,
          right: 600,
          bottom: 350
        })
      };

      const result = _getPercentInView(mockElement, mockTopWin, { w: 600, h: 250 });
      expect(result).toBeCloseTo(83.33, 2); // Element partially in view
    });
  });

  describe('_getBoundingBox', () => {
    test('should return bounding box using getBoundingClientRect', () => {
      const mockElement = {
        getBoundingClientRect: () => ({
          width: 300,
          height: 250,
          left: 100,
          top: 100,
          right: 400,
          bottom: 350
        })
      };

      const result = _getBoundingBox(mockElement);
      expect(result).toEqual({
        width: 300,
        height: 250,
        left: 100,
        top: 100,
        right: 400,
        bottom: 350
      });
    });

    test('should use provided dimensions if element size is zero', () => {
      const mockElement = {
        getBoundingClientRect: () => ({
          width: 0,
          height: 0,
          left: 100,
          top: 100,
          right: 100,
          bottom: 100
        })
      };

      const result = _getBoundingBox(mockElement, { w: 300, h: 250 });
      expect(result).toEqual({
        width: 300,
        height: 250,
        left: 100,
        top: 100,
        right: 400,
        bottom: 350
      });
    });
  });

  describe('_getIntersectionOfRects', () => {
    test('should return intersection of overlapping rectangles', () => {
      const rects = [
        { left: 0, top: 0, right: 100, bottom: 100 },
        { left: 50, top: 50, right: 150, bottom: 150 }
      ];

      const result = _getIntersectionOfRects(rects);
      expect(result).toEqual({
        left: 50,
        top: 50,
        right: 100,
        bottom: 100,
        width: 50,
        height: 50
      });
    });

    test('should return null if rectangles do not overlap', () => {
      const rects = [
        { left: 0, top: 0, right: 100, bottom: 100 },
        { left: 150, top: 150, right: 200, bottom: 200 }
      ];

      const result = _getIntersectionOfRects(rects);
      expect(result).toBeNull();
    });

    test('should handle multiple rectangles', () => {
      const rects = [
        { left: 0, top: 0, right: 100, bottom: 100 },
        { left: 25, top: 25, right: 75, bottom: 75 },
        { left: 50, top: 50, right: 150, bottom: 150 }
      ];

      const result = _getIntersectionOfRects(rects);
      expect(result).toEqual({
        left: 50,
        top: 50,
        right: 75,
        bottom: 75,
        width: 25,
        height: 25
      });
    });
  });

  describe('isBidRequestValid', function () {
    this.beforeEach(function () {
      bid = mockBidRequest();
    });

    it('Should return true if all required fileds are present', function () {
      expect(spec.isBidRequestValid(bid)).to.be.true;
    });
    it('Should return false if bidder does not correspond', function () {
      bid.bidder = 'abc';
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });
    it('Should return false if bidId is missing', function () {
      delete bid.bidId;
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });
    it('Should return false if params object is missing', function () {
      delete bid.params;
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });
    it('Should return false if placementId is missing from params', function () {
      delete bid.params.placementId;
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });
    it('Should return false if mediaTypes is missing', function () {
      delete bid.mediaTypes;
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });
    it('Should return false if both banner and video are missing from mediaTypes', function () {
      delete bid.mediaTypes.banner;
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });
    it('Should return false if sizes is missing from banner object', function () {
      delete bid.mediaTypes.banner.sizes;
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });
    it('Should return false if sizes is not an array', function () {
      bid.mediaTypes.banner.sizes = 'test';
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });
    it('Should return false if sizes is an empty array', function () {
      bid.mediaTypes.banner.sizes = [];
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });
    it('Should return true if video is set correctly', function () {
      addVideoToBidMock(bid);
      expect(spec.isBidRequestValid(bid)).to.be.true;
    });
    it('Should return false if context is set to adpod on video media type', function() {
      addVideoToBidMock(bid);
      bid.mediaTypes.video.context = ADPOD;
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });
    it('Should return true if add an extra field was added to the bidRequest', function () {
      bid.params.test = 1;
      expect(spec.isBidRequestValid(bid)).to.be.true;
    });
  });

  describe('buildRequests', function () {
    let serverRequest;
    let bidderRequest = {
      refererInfo: {
        canonicalUrl: '',
        numIframes: 0,
        reachedTop: true,
        referer: 'http://example.com',
        stack: ['http://example.com']
      },
      gdprConsent: {
        consentString: 'BOJ/P2HOJ/P2HABABMAAAAAZ+A==',
        vendorData: {},
        gdprApplies: true
      },
      uspConsent: '1YYY',
      gppConsent: {
        gppString: 'BOJ/P2HOJ/P2HABABMAAAAAZ+A==',
        applicableSections: [7]
      },
      ortb2: {
        site: {
          data: {
            pageType: 'article'
          }
        }
      }
    };

    this.beforeEach(function () {
      bid = mockBidRequest();
      serverRequest = spec.buildRequests([bid], bidderRequest);
    })

    it('Creates a ServerRequest object with method, URL and data', function () {
      expect(serverRequest).to.exist;
      expect(serverRequest.method).to.exist;
      expect(serverRequest.url).to.exist;
      expect(serverRequest.data).to.exist;
    });
    it('Returns POST method', function () {
      expect(serverRequest.method).to.equal('POST');
    });
    it('Returns valid URL', function () {
      expect(serverRequest.url).to.equal('https://capi.connatix.com/rtb/hba');
    });
    it('Returns request payload', function () {
      expect(serverRequest.data).to.not.empty;
    });
    it('Validate request payload', function () {
      expect(serverRequest.data.bidRequests[0].bidId).to.equal(bid.bidId);
      expect(serverRequest.data.bidRequests[0].placementId).to.equal(bid.params.placementId);
      expect(serverRequest.data.bidRequests[0].floor).to.equal(0);
      expect(serverRequest.data.bidRequests[0].mediaTypes).to.equal(bid.mediaTypes);
      expect(serverRequest.data.bidRequests[0].sizes).to.equal(bid.mediaTypes.sizes);
      expect(serverRequest.data.refererInfo).to.equal(bidderRequest.refererInfo);
      expect(serverRequest.data.gdprConsent).to.equal(bidderRequest.gdprConsent);
      expect(serverRequest.data.uspConsent).to.equal(bidderRequest.uspConsent);
      expect(serverRequest.data.gppConsent).to.equal(bidderRequest.gppConsent);
      expect(serverRequest.data.ortb2).to.equal(bidderRequest.ortb2);
    });
  });

  describe('interpretResponse', function () {
    const CustomerId = '99f20d18-c4b4-4a28-3d8e-d43e2c8cb4ac';
    const PlayerId = 'e4984e88-9ff4-45a3-8b9d-33aabcad634f';
    const Bid = {Cpm: 0.1, RequestId: '2f897340c4eaa3', Ttl: 86400, CustomerId, PlayerId};

    let serverResponse;
    this.beforeEach(function () {
      serverResponse = {
        body: {
          Bids: [ Bid ]
        },
        headers: function() { }
      };
    });

    it('Should return an empty array if Bids is null', function () {
      serverResponse.body.Bids = null;

      const response = spec.interpretResponse(serverResponse);
      expect(response).to.be.an('array').that.is.empty;
    });

    it('Should return an empty array if Bids is empty array', function () {
      serverResponse.body.Bids = [];
      const response = spec.interpretResponse(serverResponse);
      expect(response).to.be.an('array').that.is.empty;
    });

    it('Should return one bid response for one bid', function() {
      const bidResponses = spec.interpretResponse(serverResponse);
      expect(bidResponses.length).to.equal(1);
    });

    it('Should contains the same values as in the serverResponse', function() {
      const bidResponses = spec.interpretResponse(serverResponse);

      const [ bidResponse ] = bidResponses;
      expect(bidResponse.requestId).to.equal(serverResponse.body.Bids[0].RequestId);
      expect(bidResponse.cpm).to.equal(serverResponse.body.Bids[0].Cpm);
      expect(bidResponse.ttl).to.equal(serverResponse.body.Bids[0].Ttl);
      expect(bidResponse.currency).to.equal('USD');
      expect(bidResponse.mediaType).to.equal(BANNER);
      expect(bidResponse.netRevenue).to.be.true;
    });

    it('Should return n bid responses for n bids', function() {
      serverResponse.body.Bids = [ { ...Bid }, { ...Bid } ];

      const firstBidCpm = 4;
      serverResponse.body.Bids[0].Cpm = firstBidCpm;

      const secondBidCpm = 13;
      serverResponse.body.Bids[1].Cpm = secondBidCpm;

      const bidResponses = spec.interpretResponse(serverResponse);
      expect(bidResponses.length).to.equal(2);

      expect(bidResponses[0].cpm).to.equal(firstBidCpm);
      expect(bidResponses[1].cpm).to.equal(secondBidCpm);
    });

    it('Should contain specific values for banner bids', function () {
      const adHtml = 'ad html'
      serverResponse.body.Bids = [ { ...Bid, Ad: adHtml } ];

      const bidResponses = spec.interpretResponse(serverResponse);
      const [ bidResponse ] = bidResponses;

      expect(bidResponse.vastXml).to.be.undefined;
      expect(bidResponse.ad).to.equal(adHtml);
      expect(bidResponse.mediaType).to.equal(BANNER);
    });

    it('Should contain specific values for video bids', function () {
      const adVastXml = 'ad vast xml'
      serverResponse.body.Bids = [ { ...Bid, VastXml: adVastXml } ];

      const bidResponses = spec.interpretResponse(serverResponse);
      const [ bidResponse ] = bidResponses;

      expect(bidResponse.ad).to.be.undefined;
      expect(bidResponse.vastXml).to.equal(adVastXml);
      expect(bidResponse.mediaType).to.equal(VIDEO);
    });
  });

  describe('getUserSyncs', function() {
    const CustomerId = '99f20d18-c4b4-4a28-3d8e-d43e2c8cb4ac';
    const PlayerId = 'e4984e88-9ff4-45a3-8b9d-33aabcad634f';
    const UserSyncEndpoint = 'https://connatix.com/sync'
    const Bid = {Cpm: 0.1, RequestId: '2f897340c4eaa3', Ttl: 86400, CustomerId, PlayerId};

    const serverResponse = {
      body: {
        UserSyncEndpoint,
        Bids: [ Bid ]
      },
      headers: function() { }
    };

    it('Should return an empty array when iframeEnabled: false', function () {
      expect(spec.getUserSyncs({iframeEnabled: false, pixelEnabled: true}, [], {}, {}, {})).to.be.an('array').that.is.empty;
    });
    it('Should return an empty array when serverResponses is emprt array', function () {
      expect(spec.getUserSyncs({iframeEnabled: true, pixelEnabled: true}, [], {}, {}, {})).to.be.an('array').that.is.empty;
    });
    it('Should return an empty array when iframeEnabled: true but serverResponses in an empty array', function () {
      expect(spec.getUserSyncs({iframeEnabled: false, pixelEnabled: true}, [serverResponse], {}, {}, {})).to.be.an('array').that.is.empty;
    });
    it('Should return an empty array when iframeEnabled: true but serverResponses in an not defined or null', function () {
      expect(spec.getUserSyncs({iframeEnabled: false, pixelEnabled: true}, undefined, {}, {}, {})).to.be.an('array').that.is.empty;
      expect(spec.getUserSyncs({iframeEnabled: false, pixelEnabled: true}, null, {}, {}, {})).to.be.an('array').that.is.empty;
    });
    it('Should return one user sync object when iframeEnabled is true and serverResponses is not an empry array', function () {
      expect(spec.getUserSyncs({iframeEnabled: true, pixelEnabled: true}, [serverResponse], {}, {}, {})).to.be.an('array').that.is.not.empty;
    });
    it('Should return a list containing a single object having type: iframe and url: syncUrl', function () {
      const userSyncList = spec.getUserSyncs({iframeEnabled: true, pixelEnabled: true}, [serverResponse], undefined, undefined, undefined);
      const { type, url } = userSyncList[0];
      expect(type).to.equal('iframe');
      expect(url).to.equal(UserSyncEndpoint);
    });
    it('Should append gdpr: 0 if gdprConsent object is provided but gdprApplies field is not provided', function () {
      const userSyncList = spec.getUserSyncs(
        {iframeEnabled: true, pixelEnabled: true},
        [serverResponse],
        {},
        undefined,
        undefined
      );
      const { url } = userSyncList[0];
      expect(url).to.equal(`${UserSyncEndpoint}?gdpr=0`);
    });
    it('Should append gdpr having the value of gdprApplied if gdprConsent object is present and have gdprApplies field', function () {
      const userSyncList = spec.getUserSyncs(
        {iframeEnabled: true, pixelEnabled: true},
        [serverResponse],
        {gdprApplies: true},
        undefined,
        undefined
      );
      const { url } = userSyncList[0];
      expect(url).to.equal(`${UserSyncEndpoint}?gdpr=1`);
    });
    it('Should append gdpr_consent if gdprConsent object is present and have gdprApplies field', function () {
      const userSyncList = spec.getUserSyncs(
        {iframeEnabled: true, pixelEnabled: true},
        [serverResponse],
        {gdprApplies: true, consentString: 'alabala'},
        undefined,
        undefined
      );
      const { url } = userSyncList[0];
      expect(url).to.equal(`${UserSyncEndpoint}?gdpr=1&gdpr_consent=alabala`);
    });
    it('Should encodeURI gdpr_consent corectly', function () {
      const userSyncList = spec.getUserSyncs(
        {iframeEnabled: true, pixelEnabled: true},
        [serverResponse],
        {gdprApplies: true, consentString: 'test&2'},
        undefined,
        undefined
      );
      const { url } = userSyncList[0];
      expect(url).to.equal(`${UserSyncEndpoint}?gdpr=1&gdpr_consent=test%262`);
    });
    it('Should append usp_consent to the url if uspConsent is provided', function () {
      const userSyncList = spec.getUserSyncs(
        {iframeEnabled: true, pixelEnabled: true},
        [serverResponse],
        {gdprApplies: true, consentString: 'test&2'},
        '1YYYN',
        undefined
      );
      const { url } = userSyncList[0];
      expect(url).to.equal(`${UserSyncEndpoint}?gdpr=1&gdpr_consent=test%262&us_privacy=1YYYN`);
    });
    it('Should not modify the sync url if gppConsent param is provided', function () {
      const userSyncList = spec.getUserSyncs(
        {iframeEnabled: true, pixelEnabled: true},
        [serverResponse],
        {gdprApplies: true, consentString: 'test&2'},
        '1YYYN',
        {consent: '1'}
      );
      const { url } = userSyncList[0];
      expect(url).to.equal(`${UserSyncEndpoint}?gdpr=1&gdpr_consent=test%262&us_privacy=1YYYN`);
    });
  });

  describe('getBidFloor', function () {
    this.beforeEach(function () {
      bid = mockBidRequest();
    });

    it('Should return 0 if both getFloor method and bidfloor param from bid are absent.', function () {
      const floor = connatixGetBidFloor(bid);
      expect(floor).to.equal(0);
    });

    it('Should return the value of the bidfloor parameter if the getFloor method is not defined but the bidfloor parameter is defined', function () {
      const floorValue = 3;
      bid.params.bidfloor = floorValue;

      const floor = connatixGetBidFloor(bid);
      expect(floor).to.equal(floorValue);
    });

    it('Should return the value of the getFloor method if the getFloor method is defined but the bidfloor parameter is not defined', function () {
      const floorValue = 7;
      bid.getFloor = function() {
        return { floor: floorValue };
      };

      const floor = connatixGetBidFloor(bid);
      expect(floor).to.equal(floorValue);
    });

    it('Should return the value of the getFloor method if both getFloor method and bidfloor parameter are defined', function () {
      const floorParamValue = 3;
      bid.params.bidfloor = floorParamValue;

      const floorMethodValue = 7;
      bid.getFloor = function() {
        return { floor: floorMethodValue };
      };

      const floor = connatixGetBidFloor(bid);
      expect(floor).to.equal(floorMethodValue);
    });

    it('Should return 0 if the getFloor method is defined and it crash when call it', function () {
      bid.getFloor = function() {
        throw new Error('error');
      };
      const floor = connatixGetBidFloor(bid);
      expect(floor).to.equal(0);
    });
  });
});
