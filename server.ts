import express from 'express';
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
const USE_PKCE = process.env.NS_USE_PKCE;

const CODE_VERIFIERS: Record<string, string> = {};

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
        return handleTokenRequest({ grant: authCode, grantType: 'authorization_code', res, entity, state });
    }
    if (refreshToken) {
        return handleTokenRequest({ grant: refreshToken, grantType: 'refresh_token', res, entity, state });
    }
    const authCodeUrl = USE_PKCE ? createAuthCodeUrlWithPKCE() : createAuthCodeUrl();
    res.redirect(authCodeUrl);
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
        state: generateUUID(),
    });
    console.log(params);
    return baseUrl + '?' + params.toString();
}

function createAuthCodeUrlWithPKCE(): string {
    const baseUrl = `https://${ACCOUNT}.app.netsuite.com/app/login/oauth2/authorize.nl`;
    const state = generateUUID();
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

function generateUUID(): string {
    let d = new Date().getTime();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        let r = Math.random() * 16;
        r = (d + r) % 16 | 0;
        d = Math.floor(d / 16);
        return (c == 'x' ? r : (r & 0x7 | 0x8)).toString(16);
    });
}

function generateCodeVerifier(state: string): string {
    const code = generateUUID() + generateUUID();
    CODE_VERIFIERS[state] = code;
    return code;
}

/**
 * STEP TWO: Get Access Token
 */


async function handleTokenRequest({ grant, grantType, res, entity, state }: HandleTokenRequestParams): Promise<void> {
    try {
        const response = USE_PKCE
            ? await fetchAccessTokenWithPKCE(grant, grantType, state)
            : await fetchAccessToken(grant, grantType);
        res.setHeader('Content-Type', 'text/html');
        res.send(ResultsPage(response, grant, grantType, entity));
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
        Authorization: createBasicAuthString(),
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

function createBasicAuthString(): string {
    const authStr = `${CLIENT_ID}:${CLIENT_SECRET}`;
    return `Basic ${Buffer.from(authStr).toString('base64')}`;
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

function ResultsPage(response: TokenData, grant: string, grantType: GrantType, entity: string): string {
    const authCode = grantType === 'authorization_code' ? grant : 'N/A';
    const refreshToken = grantType === 'refresh_token' ? grant : response.refresh_token;
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

        <b>Access Token</b>
        <p>${response.access_token}</p>

        <b>Refresh Token</b>
        <p>${refreshToken}</p>

        <b>Entity</b>
        <p>${entity}</p>

        <a href="./employee/${entity}/${response.access_token}" target="_blank">Fetch Employee</a>

        <a href="./?refresh=${refreshToken}&entity=${entity}">Refresh Access Token</a>
        <a href="./">Start Over</a>
    </body>
    </html>
    `;
}

type TokenData = {
    access_token: string;
    refresh_token: string;
    expires_in: 3600;
    token_type: 'bearer';
    id_token: unknown;
}

type PostResponse = {
    status: number;
    statusText: string;
    data: string;
};

type GrantType = 'authorization_code' | 'refresh_token';

type HandleTokenRequestParams = { grant: string; grantType: GrantType; res: express.Response; entity: string; state: string; };

