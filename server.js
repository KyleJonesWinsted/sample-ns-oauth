"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = __importDefault(require("express"));
var app = (0, express_1.default)();
var CLIENT_ID = process.env.NS_CLIENT;
var CLIENT_SECRET = process.env.NS_SECRET;
var SCOPE = process.env.NS_SCOPE;
var ACCOUNT = process.env.NS_ACCOUNT;
var REDIRECT_URI = 'https://kylejon.es/netsuite-oauth/'; // Your URL here
app.use(function (req) {
    var _a;
    console.log('request from', req.url);
    (_a = req.next) === null || _a === void 0 ? void 0 : _a.call(req);
});
app.get('/', function (req, res) {
    console.log(req.params);
    var authCode = req.query.code;
    var refreshToken = req.query.refresh;
    if (authCode) {
        return handleTokenRequest(authCode, 'code', res);
    }
    if (refreshToken) {
        return handleTokenRequest(refreshToken, 'refresh_token', res);
    }
    var authCodeUrl = createAuthCodeUrl();
    res.redirect(authCodeUrl);
});
app.listen(3000, function () {
    console.log('listening on port 3000');
});
function createAuthCodeUrl() {
    var baseUrl = "https://".concat(ACCOUNT, ".app.netsuite.com/app/login/oauth2/authorize.nl");
    var params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state: generateUUID(),
    });
    return baseUrl + '?' + params.toString();
}
function handleTokenRequest(grant, grantType, res) {
    res.send(grantType + ' ' + grant);
}
function generateUUID() {
    var d = new Date().getTime();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16;
        r = (d + r) % 16 | 0;
        d = Math.floor(d / 16);
        return (c == 'x' ? r : (r & 0x7 | 0x8)).toString(16);
    });
}
