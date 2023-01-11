import express from 'express';
import https from 'https';
import { URLSearchParams } from 'url';
import { isNativeError } from 'util/types';

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

const app = express();

const CLIENT_ID = process.env.NS_CLIENT!;
const CLIENT_SECRET = process.env.NS_SECRET!;
const SCOPE = process.env.NS_SCOPE!;
const ACCOUNT = process.env.NS_ACCOUNT!;
const REDIRECT_URI = process.env.NS_REDIRECT_URI!;

app.use((req) => {
    console.log('request from', req.url);
    req.next?.();
});

app.get('/', (req, res) => {
    const authCode = req.query.code as string;
    const refreshToken = req.query.refresh as string;
    const entity = req.query.entity as string;
    if (authCode) {
        return handleTokenRequest(authCode, 'authorization_code', res, entity);
    }
    if (refreshToken) {
        return handleTokenRequest(refreshToken, 'refresh_token', res, entity);
    }
    const authCodeUrl = createAuthCodeUrl();
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

function createAuthCodeUrl(): string {
    const baseUrl = `https://${ACCOUNT}.app.netsuite.com/app/login/oauth2/authorize.nl`;
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state: generateUUID(),
    });
    return baseUrl + '?' + params.toString();
}

async function handleTokenRequest(grant: string, grantType: GrantType, res: express.Response, entity: string): Promise<void> {
    try {
        const response = await fetchAccessToken(grant, grantType);
        res.setHeader('Content-Type', 'text/html');
        res.send(ResultsPage(response, grant, grantType, entity));
    } catch (err) {
        handleError(err, res);
    }
}

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
    const response = await postRequest(body, headers);
    if (response.status > 299) throw new Error(`Error fetching token: ${response.status} ${response.statusText}`);
    return JSON.parse(response.data) as TokenData;
}

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

function postRequest(body: string, headers: Record<string, any>): Promise<PostResponse> {
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
                status: res.statusCode ?? 1000,
                statusText: res.statusMessage ?? 'No status'
            }));
            res.on('error', (e) => reject(e));
        });
        req.write(body);
        req.end();
    });
}

function createBasicAuthString(): string {
    const authStr = `${CLIENT_ID}:${CLIENT_SECRET}`;
    return `Basic ${Buffer.from(authStr).toString('base64')}`;
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

function ResultsPage(response: TokenData, grant: string, grantType: GrantType, entity: string): string {
    return /*html*/`
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NS OAuth 2.0</title>
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

        <b>${grantType === 'authorization_code' ? 'Authorization Code' : 'Old Refresh Token'}</b>
        <p>${grant}</p>

        <b>Access Token</b>
        <p>${response.access_token}</p>

        <b>Refresh Token</b>
        <p>${response.refresh_token}</p>

        <b>Entity</b>
        <p>${entity}</p>

        <a href="/netsuite-oauth/employee/${entity}/${response.access_token}" target="_blank">Fetch Employee</a>

        <a href="/netsuite-oauth?refresh=${response.refresh_token}&entity=${entity}">Refresh Access Token</a>
        <a href="/netsuite-oauth/">Start Over</a>
    </body>
    </html>
    `;
}
