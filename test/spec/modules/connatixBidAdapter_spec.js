import { expect } from 'chai';
import {
  spec,
  getBidFloor as connatixGetBidFloor,
  wrapAd as connatixWrapAd
} from '../../../modules/connatixBidAdapter.js';
import { BANNER } from '../../../src/mediaTypes.js';

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
    it('Should return false if banner is missing from mediaTypes ', function () {
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
      expect(serverRequest.data.ortb2).to.equal(bidderRequest.ortb2);
    });
  });

  describe('interpretResponse', function () {
    const CustomerId = '99f20d18-c4b4-4a28-3d8e-d43e2c8cb4ac';
    const PlayerId = 'e4984e88-9ff4-45a3-8b9d-33aabcad634f';
    const Bid = {Cpm: 0.1, LineItems: [], RequestId: '2f897340c4eaa3', Ttl: 86400};

    let serverResponse;
    this.beforeEach(function () {
      serverResponse = {
        body: {
          CustomerId,
          PlayerId,
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

    it('Should return an empty array if CustomerId is null', function () {
      serverResponse.body.CustomerId = null;
      const response = spec.interpretResponse(serverResponse);
      expect(response).to.be.an('array').that.is.empty;
    });

    it('Should return an empty array if PlayerId is null', function () {
      serverResponse.body.PlayerId = null;
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
  });

  describe('getUserSyncs', function() {
    it('Returns always an empty array because we do not do user sync for now', function () {
      expect(spec.getUserSyncs({}, [], {}, {}, {})).to.be.an('array').that.is.empty;
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

  describe('wrapAd', function () {
    const lineItems = [{
      LineItem: {},
      Bids: {},
    }];

    const requestId = 'requestId';
    const customerId = '99f20d18-c4b4-4a28-3d8e-d43e2c8cb4ac';
    const playerId = 'e4984e88-9ff4-45a3-8b9d-33aabcad634f';

    let inApp;
    this.beforeEach(function () {
      bid = mockBidRequest();
      inApp = false;
    });

    it('Should return a string containing the Connatix player grab code with the bid injected through external JS API', function () {
      const ad = connatixWrapAd(lineItems, requestId, playerId, customerId, inApp);
      expect(ad).to.be.an('string').that.is.not.empty;
    });

    it('Should return a string that contains requestId, customerId and playerId', function () {
      const ad = connatixWrapAd(lineItems, requestId, playerId, customerId, inApp);
      expect(ad).to.contains(requestId);
      expect(ad).to.contains(customerId);
      expect(ad).to.contains(playerId);

      const settingsJson = {
        advertising: {
          standaloneLineItems: lineItems
        }
      };
      const settingsJsonString = JSON.stringify(settingsJson);
      expect(ad).to.contains(settingsJsonString);
    });
  });
});
