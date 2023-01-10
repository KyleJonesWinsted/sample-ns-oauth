"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const https_1 = __importDefault(require("https"));
const url_1 = require("url");
const app = (0, express_1.default)();
const CLIENT_ID = process.env.NS_CLIENT;
const CLIENT_SECRET = process.env.NS_SECRET;
const SCOPE = process.env.NS_SCOPE;
const ACCOUNT = process.env.NS_ACCOUNT;
const REDIRECT_URI = 'https://kylejon.es/netsuite-oauth/'; // Your URL here
app.use((req) => {
    console.log('request from', req.url);
    req.next?.();
});
app.get('/', (req, res) => {
    const authCode = req.query.code;
    const refreshToken = req.query.refresh;
    if (authCode) {
        return handleTokenRequest(authCode, 'authorization_code', res);
    }
    if (refreshToken) {
        return handleTokenRequest(refreshToken, 'refresh_token', res);
    }
    const authCodeUrl = createAuthCodeUrl();
    res.redirect(authCodeUrl);
});
app.listen(3000, () => {
    console.log('listening on port 3000');
});
function createAuthCodeUrl() {
    const baseUrl = `https://${ACCOUNT}.app.netsuite.com/app/login/oauth2/authorize.nl`;
    const params = new url_1.URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state: generateUUID(),
    });
    return baseUrl + '?' + params.toString();
}
async function handleTokenRequest(grant, grantType, res) {
    try {
        const response = await fetchAccessToken(grant, grantType);
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(response));
    }
    catch (err) {
        res.send(JSON.stringify(err));
    }
}
async function fetchAccessToken(grant, grantType) {
    const body = new url_1.URLSearchParams({
        code: grant,
        grant_type: grantType,
        redirect_uri: REDIRECT_URI,
    }).toString();
    const headers = {
        Host: `${ACCOUNT}.suitetalk.api.netsuite.com`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': body.length,
        Authorization: createBasicAuthString(),
    };
    const response = await postRequest(body, headers);
    if (response.status > 299)
        throw new Error(`Error fetching token: ${response.status} ${response.statusText}`);
    return JSON.parse(response.data);
}
function postRequest(body, headers) {
    let data = '';
    return new Promise((resolve, reject) => {
        const req = https_1.default.request({
            hostname: `${ACCOUNT}.suitetalk.api.netsuite.com`,
            path: '/services/rest/auth/oauth2/v1/token',
            method: 'POST',
            headers,
        }, (res) => {
            res.on('data', (d) => data += d);
            res.on('end', () => resolve({
                data,
                status: res.statusCode ?? 99,
                statusText: res.statusMessage ?? 'No status'
            }));
            res.on('error', (e) => reject(e));
        });
        req.write(body);
        req.end();
    });
}
function createBasicAuthString() {
    const authStr = `${CLIENT_ID}:${CLIENT_SECRET}`;
    return `Basic ${Buffer.from(authStr).toString('base64')}`;
}
function generateUUID() {
    let d = new Date().getTime();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        let r = Math.random() * 16;
        r = (d + r) % 16 | 0;
        d = Math.floor(d / 16);
        return (c == 'x' ? r : (r & 0x7 | 0x8)).toString(16);
    });
}
