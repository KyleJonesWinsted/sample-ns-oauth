const IDs = {
    dataDiv: "data",
    authCode: "auth-code",
    accessToken: "access-token",
    refreshToken: "refresh-token",
} as const;

const Inputs = {
    clientId: "client-id",
    clientSecret: "client-secret",
    scope: "scope",
} as const;

const Buttons = {
    auth: document.getElementById("auth-button") as HTMLButtonElement,
    token: document.getElementById("token-button") as HTMLButtonElement,
    refresh: document.getElementById("refresh-button") as HTMLButtonElement
};

document.addEventListener('DOMContentLoaded', () => {
    const code = new URLSearchParams(document.location.search).get('code');
    if (!code) return;
    document.getElementById(IDs.authCode)!.innerHTML = code;
})

for (const id of Object.values(Inputs)) {
    const input = document.getElementById(id) as HTMLInputElement;
    setStoredValue(id, input);
    input.addEventListener('keyup', () => {
        const value = input.value;
        handleParamChange(id, value);
    });
}

function setStoredValue(id: string, input: HTMLInputElement): void {
    const value = localStorage.getItem(id);
    if (!value) return;
    input.value = value;
}

function handleParamChange(id: string, value: string): void {
    localStorage.setItem(id, value);
}

Buttons.auth.addEventListener('click', () => {

});

Buttons.token.addEventListener('click', () => {

});

Buttons.refresh.addEventListener('click', () => {

});
