"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const url_1 = require("url");
const types_1 = require("util/types");
const crypto_1 = __importDefault(require("crypto"));
const app = (0, express_1.default)();
const CLIENT_ID = process.env.NS_CLIENT;
const CLIENT_SECRET = process.env.NS_SECRET;
const SCOPE = process.env.NS_SCOPE;
const ACCOUNT = process.env.NS_ACCOUNT;
const REDIRECT_URI = process.env.NS_REDIRECT_URI;
// Used only in PKCE flow
const USE_PKCE = process.env.NS_USE_PKCE;
const CODE_VERIFIERS = {};
// Used only in Client Credentials flow
const CERTIFICATE_ID = process.env.NS_CERTIFICATE_ID;
const KEY_PATH = process.env.NS_KEY_PATH;
const PRIVATE_KEY = KEY_PATH ? fs_1.default.readFileSync(KEY_PATH).toString() : '';
app.use((req) => {
    console.log('request from', req.url);
    req.next?.();
});
app.get('/', (req, res) => {
    const error = req.query.error;
    const authCode = req.query.code;
    const refreshToken = req.query.refresh;
    const entity = req.query.entity;
    const state = req.query.state;
    if (error) {
        return handleError(error, res);
    }
    if (authCode) {
        return handleTokenRequest(res, { grant: authCode, grantType: 'authorization_code', entity, state });
    }
    if (refreshToken) {
        return handleTokenRequest(res, { grant: refreshToken, grantType: 'refresh_token', entity, state });
    }
    const authCodeUrl = USE_PKCE ? createAuthCodeUrlWithPKCE() : createAuthCodeUrl();
    res.redirect(authCodeUrl);
});
app.get('/client-credentials', async (_, res) => {
    try {
        const tokenData = await fetchAccessTokenWithClientCredentials();
        const entity = parseEntityFromToken(tokenData);
        res.send(ResultsPage(tokenData, {
            entity,
            grant: 'N/a',
            grantType: 'client_credentials',
            state: 'N/A'
        }));
    }
    catch (err) {
        console.log(err);
        handleError(err, res);
    }
});
app.get('/employee/:id/:token', async (req, res) => {
    try {
        const employee = await fetchEmployee(req.params.id, req.params.token);
        res.setHeader('Content-Type', 'application/json');
        res.send(employee);
    }
    catch (err) {
        handleError(err, res);
    }
});
app.listen(3000, () => {
    console.log('listening on port 3000');
});
/**
 * STEP ONE: Get Authorization Code
 */
function createAuthCodeUrl() {
    const baseUrl = `https://${ACCOUNT}.app.netsuite.com/app/login/oauth2/authorize.nl`;
    const params = new url_1.URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state: crypto_1.default.randomUUID(),
    });
    console.log(params);
    return baseUrl + '?' + params.toString();
}
function createAuthCodeUrlWithPKCE() {
    const baseUrl = `https://${ACCOUNT}.app.netsuite.com/app/login/oauth2/authorize.nl`;
    const state = crypto_1.default.randomUUID();
    const verifier = generateCodeVerifier(state);
    const challenge = crypto_1.default.createHash('sha256').update(verifier).digest('base64url');
    const params = new url_1.URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
    });
    console.log(params);
    return baseUrl + '?' + params.toString();
}
function generateCodeVerifier(state) {
    const code = crypto_1.default.randomUUID() + crypto_1.default.randomUUID();
    CODE_VERIFIERS[state] = code;
    return code;
}
/**
 * STEP TWO: Get Access Token
 */
async function handleTokenRequest(res, params) {
    const { grant, grantType, state } = params;
    try {
        const response = USE_PKCE
            ? await fetchAccessTokenWithPKCE(grant, grantType, state)
            : await fetchAccessToken(grant, grantType);
        res.setHeader('Content-Type', 'text/html');
        res.send(ResultsPage(response, params));
    }
    catch (err) {
        handleError(err, res);
    }
}
async function fetchAccessToken(grant, grantType) {
    const body = new url_1.URLSearchParams({
        [grantType === 'authorization_code' ? 'code' : 'refresh_token']: grant,
        grant_type: grantType,
        redirect_uri: REDIRECT_URI,
    }).toString();
    const headers = {
        Host: `${ACCOUNT}.suitetalk.api.netsuite.com`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': body.length,
        Authorization: 'Basic ' + base64Encode(`${CLIENT_ID}:${CLIENT_SECRET}`),
    };
    console.log({ headers, body });
    const response = await tokenRequest(body, headers);
    if (response.status > 299)
        throw new Error(`Error fetching token: ${response.status} ${response.statusText}`);
    return JSON.parse(response.data);
}
async function fetchAccessTokenWithPKCE(grant, grantType, state) {
    const body = new url_1.URLSearchParams({
        [grantType === 'authorization_code' ? 'code' : 'refresh_token']: grant,
        grant_type: grantType,
        redirect_uri: REDIRECT_URI,
        code_verifier: CODE_VERIFIERS[state],
        client_id: CLIENT_ID,
    }).toString();
    const headers = {
        Host: `${ACCOUNT}.suitetalk.api.netsuite.com`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': body.length,
    };
    console.log({ headers, body });
    const response = await tokenRequest(body, headers);
    if (response.status > 299)
        throw new Error(`Error fetching token: ${response.status} ${response.statusText}`);
    return JSON.parse(response.data);
}
async function fetchAccessTokenWithClientCredentials() {
    const body = new url_1.URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: createClientAssertion(),
    }).toString();
    const headers = {
        Host: `${ACCOUNT}.suitetalk.api.netsuite.com`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': body.length,
    };
    console.log({ headers, body });
    const response = await tokenRequest(body, headers);
    if (response.status > 299)
        throw new Error(`Error fetching token: ${response.status} ${response.statusText}`);
    return JSON.parse(response.data);
}
function createClientAssertion() {
    const header = base64Encode({
        typ: 'JWT',
        alg: 'RS256',
        kid: CERTIFICATE_ID,
    }, true);
    const timestamp = new Date().getTime() / 1000;
    const payload = base64Encode({
        iss: CLIENT_ID,
        scope: SCOPE.replaceAll(' ', ','),
        aud: `https://${ACCOUNT}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`,
        iat: +timestamp.toFixed(0),
        exp: +(timestamp + 3000).toFixed(0)
    }, true);
    const signature = crypto_1.default.createSign('RSA-SHA256')
        .update(`${header}.${payload}`)
        .sign({ key: PRIVATE_KEY }, 'base64url')
        .toString();
    return `${header}.${payload}.${signature}`;
}
function base64Encode(data, urlSafe = false) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return Buffer.from(str).toString(urlSafe ? 'base64url' : 'base64');
}
function tokenRequest(body, headers) {
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
                status: res.statusCode,
                statusText: res.statusMessage
            }));
            res.on('error', (e) => reject(e));
        });
        req.write(body);
        req.end();
    });
}
/**
 * STEP THREE: Fetch Data from NetSuite
 */
function fetchEmployee(id, token) {
    let data = '';
    return new Promise((resolve, reject) => {
        const req = https_1.default.request({
            hostname: `${ACCOUNT}.suitetalk.api.netsuite.com`,
            path: `/services/rest/record/v1/employee/${id}`,
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`
            },
        }, (res) => {
            res.on('data', (d) => data += d);
            res.on('end', () => resolve(data));
            res.on('error', (e) => reject(e));
        });
        req.end();
    });
}
function parseEntityFromToken(data) {
    const payloadString = data.access_token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadString, 'base64').toString('ascii'));
    return payload.sub.split(';')[1];
}
/**
 * MISC FUNCTIONS AND TYPES
 */
function handleError(err, res) {
    console.error(err);
    if ((0, types_1.isNativeError)(err)) {
        res.send(/*html*/ `
                <h1>${err.name}</h1>
                <p>${err.message}</p>
                <p>${err.stack ?? 'No Stack'}</p>
            `);
    }
    else {
        res.send('An error occurred: ' + JSON.stringify(err));
    }
}
function ResultsPage(response, params) {
    const { grantType, grant, entity, state } = params;
    const authCode = grantType === 'authorization_code' ? grant : 'N/A';
    const refreshToken = response.refresh_token || grant;
    return /*html*/ `
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NS OAuth 2.0</title>
        <style>
            * {
                font-family: sans-serif;
            }

            body {
                padding: 25px;
                display: grid;
                grid-template-columns: 185px 1fr;
            }

            a {
                display: block;
                margin: 15px;
                grid-column: 1 / 3;
                font-size: large;
                text-align: center;
            }

            p {
                word-break: break-all;
            }

            b {
                margin: auto 0;
            }
        </style>
    </head>
    <body>
        <b>Client ID</b>
        <p>${CLIENT_ID}</p>

        <b>Scope</b>
        <p>${SCOPE}</p>

        <b>Account</b>
        <p>${ACCOUNT}</p>

        <b>Redirect URI</b>
        <p>${REDIRECT_URI}</p>

        <b>Authorization Code</b>
        <p>${authCode}</p>

        <b>State</b>
        <p>${state ?? 'N/A'}</p>

        <b>Code Verifier</b>
        <p>${CODE_VERIFIERS[state] ?? 'N/A'}</p>

        <b>Access Token</b>
        <p>${response.access_token}</p>

        <b>Refresh Token</b>
        <p>${refreshToken}</p>

        <b>Entity</b>
        <p>${entity}</p>

        <a href="./employee/${entity}/${response.access_token}" target="_blank">Fetch Employee</a>

        ${refreshToken ?
        /*html*/ `<a href="./?refresh=${refreshToken}&entity=${entity}">Refresh Access Token</a>`
        : ''}
        <a href="./">Start Over</a>
    </body>
    </html>
    `;
}
