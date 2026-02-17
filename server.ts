import express from 'express';
import fs from 'fs';
import https from 'https';
import { URLSearchParams } from 'url';
import { isNativeError } from 'util/types';
import crypto from 'crypto';

const app = express();

const CLIENT_ID = process.env.NS_CLIENT!;
const CLIENT_SECRET = process.env.NS_SECRET!;
const SCOPE = process.env.NS_SCOPE!;
const ACCOUNT = process.env.NS_ACCOUNT!;
const REDIRECT_URI = process.env.NS_REDIRECT_URI!;

// Used only in PKCE flow
const USE_PKCE = process.env.NS_USE_PKCE;
const CODE_VERIFIERS: Record<string, string> = {};

// Used only in Client Credentials flow
const CERTIFICATE_ID = process.env.NS_CERTIFICATE_ID;
const KEY_PATH = process.env.NS_KEY_PATH;
const PRIVATE_KEY = KEY_PATH ? fs.readFileSync(KEY_PATH).toString() : '';

app.use((req) => {
    console.log('request from', req.url);
    req.next?.();
});

app.get('/', (req, res) => {
    const error = req.query.error as string;
    const authCode = req.query.code as string;
    const refreshToken = req.query.refresh as string;
    const entity = req.query.entity as string;
    const state = req.query.state as string;
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
    } catch (err) {
        console.log(err);
        handleError(err, res);
    }

});

app.get('/employee/:id/:token', async (req, res) => {
    try {
        const employee = await fetchEmployee(req.params.id, req.params.token);
        res.setHeader('Content-Type', 'application/json');
        res.send(employee);
    } catch (err) {
        handleError(err, res);
    }
});

app.listen(3000, () => {
    console.log('listening on port 3000');
});

/**
 * STEP ONE: Get Authorization Code
 */

function createAuthCodeUrl(): string {
    const baseUrl = `https://${ACCOUNT}.app.netsuite.com/app/login/oauth2/authorize.nl`;
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state: crypto.randomUUID(),
    });
    console.log(params);
    return baseUrl + '?' + params.toString();
}

function createAuthCodeUrlWithPKCE(): string {
    const baseUrl = `https://${ACCOUNT}.app.netsuite.com/app/login/oauth2/authorize.nl`;
    const state = crypto.randomUUID();
    const verifier = generateCodeVerifier(state);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const params = new URLSearchParams({
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

function generateCodeVerifier(state: string): string {
    const code = crypto.randomUUID() + crypto.randomUUID();
    CODE_VERIFIERS[state] = code;
    return code;
}

/**
 * STEP TWO: Get Access Token
 */


async function handleTokenRequest(res: express.Response, params: RequestParams): Promise<void> {
    const { grant, grantType, state } = params;
    try {
        const response = USE_PKCE
            ? await fetchAccessTokenWithPKCE(grant, grantType, state)
            : await fetchAccessToken(grant, grantType);
        res.setHeader('Content-Type', 'text/html');
        res.send(ResultsPage(response, params));
    } catch (err) {
        handleError(err, res);
    }
}

async function fetchAccessToken(grant: string, grantType: GrantType): Promise<TokenData> {
    const body = new URLSearchParams({
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
    if (response.status > 299) throw new Error(`Error fetching token: ${response.status} ${response.statusText}`);
    return JSON.parse(response.data) as TokenData;
}

async function fetchAccessTokenWithPKCE(grant: string, grantType: GrantType, state: string): Promise<TokenData> {
    const body = new URLSearchParams({
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
    if (response.status > 299) throw new Error(`Error fetching token: ${response.status} ${response.statusText}`);
    return JSON.parse(response.data) as TokenData;
}

async function fetchAccessTokenWithClientCredentials(): Promise<TokenData> {
    const body = new URLSearchParams({
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
    if (response.status > 299) throw new Error(`Error fetching token: ${response.status} ${response.statusText}`);
    return JSON.parse(response.data) as TokenData;
}

function createClientAssertion(): string {
    const header = base64Encode({
        typ: 'JWT',
        alg: 'ES256',
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
    const signature = crypto.createSign('sha256')
        .update(`${header}.${payload}`)
        .sign({ key: PRIVATE_KEY, dsaEncoding: 'ieee-p1363' }, 'base64url')
        .toString();
    return `${header}.${payload}.${signature}`;
}

function base64Encode(data: any, urlSafe: boolean = false): string {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return Buffer.from(str).toString(urlSafe ? 'base64url' : 'base64');
}

function tokenRequest(body: string, headers: Record<string, any>): Promise<PostResponse> {
    let data = '';
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: `${ACCOUNT}.suitetalk.api.netsuite.com`,
            path: '/services/rest/auth/oauth2/v1/token',
            method: 'POST',
            headers,
        }, (res) => {
            res.on('data', (d) => data += d);
            res.on('end', () => resolve({
                data,
                status: res.statusCode!,
                statusText: res.statusMessage!
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

function fetchEmployee(id: string, token: string): Promise<string> {
    let data = '';
    return new Promise((resolve, reject) => {
        const req = https.request({
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

function parseEntityFromToken(data: TokenData): string {
    const payloadString = data.access_token.split('.')[1];
    const payload: TokenPayload = JSON.parse(Buffer.from(payloadString, 'base64').toString('ascii'));
    return payload.sub.split(';')[1];
}

/**
 * MISC FUNCTIONS AND TYPES
 */

function handleError(err: unknown, res: express.Response<any, Record<string, any>>) {
    console.error(err);
    if (isNativeError(err)) {
        res.send(/*html*/ `
                <h1>${err.name}</h1>
                <p>${err.message}</p>
                <p>${err.stack ?? 'No Stack'}</p>
            `);
    } else {
        res.send('An error occurred: ' + JSON.stringify(err));
    }
}

function ResultsPage(response: TokenData, params: RequestParams): string {
    const { grantType, grant, entity, state } = params;
    const authCode = grantType === 'authorization_code' ? grant : 'N/A';
    const refreshToken = response.refresh_token || grant;
    return /*html*/`
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
            /*html*/`<a href="./?refresh=${refreshToken}&entity=${entity}">Refresh Access Token</a>`
            : ''
        }
        <a href="./">Start Over</a>
    </body>
    </html>
    `;
}

type TokenData = {
    access_token: string;
    refresh_token?: string;
    expires_in: 3600;
    token_type: 'bearer';
}

type PostResponse = {
    status: number;
    statusText: string;
    data: string;
};

type GrantType = 'authorization_code' | 'refresh_token' | 'client_credentials';

type RequestParams = { grant: string; grantType: GrantType; entity: string; state: string; };

type TokenPayload = {
    sub: string;
    aud: string[];
    scope: string[];
    iss: string;
    oit: number;
    exp: number;
    iat: number;
    jti: string;
}

