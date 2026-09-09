/**
 * Ce que la XAPI du 3CX permet d'ÉCRIRE sur un poste — vérification sur pièces.
 *
 * Le script d'entrée des collaborateurs doit un jour créer un poste et y
 * recopier la configuration d'un collègue. Rien de tout cela n'a jamais été
 * exercé : ce diagnostic le fait sur un poste jetable, puis le supprime.
 *
 *   npx tsx --env-file=.env scripts/diag-xapi-postes.ts            (lecture seule)
 *   npx tsx --env-file=.env scripts/diag-xapi-postes.ts --go 110   (écrit, puis nettoie)
 *
 * Sans --go : aucune écriture, on n'affiche que ce qui serait envoyé.
 * Avec --go : crée un poste au premier numéro libre, y copie le modèle,
 * relit, compare, et le SUPPRIME dans tous les cas (même en cas d'échec).
 */
import { getServerXapiConfig } from "../lib/xapi-config";

const GO = process.argv.includes("--go");
const MODELE = process.argv.find((a) => /^\d{3,4}$/.test(a)) ?? "110";
const MARQUEUR = "ZZ ESSAI SCRIPT";

/** Ce qu'une copie NE doit jamais reprendre : identité, secrets, matériel, numéros directs. */
const JAMAIS_COPIE = new Set([
    "Id", "Number", "FirstName", "LastName", "DisplayName", "EmailAddress", "Mobile",
    "AuthID", "AuthPassword", "AccessPassword", "DeskphonePassword", "SIPID", "VMPIN",
    "OutboundCallerID", "ContactImage", "WebMeetingFriendlyName", "EnableHotdesking",
    "HotdeskingAssignment", "IsRegistered", "CurrentProfileName", "QueueStatus",
    "EmergencyLocationId", "EmergencyAdditionalInfo", "Phones", "Greetings", "Tags",
    // Décidés à part : propres à la personne ou à la sécurité, pas à la fonction.
    "Enabled", "AIAgent", "Enable2FA", "Require2FA", "AgentSettings",
]);

/** Ce qu'on veut au contraire reprendre tel quel. */
const A_COPIER = [
    "Blfs", "Language", "PromptSet", "RecordCalls", "RecordExternalCallsOnly", "AllowOwnRecordings",
    "RecordEmailNotify", "SendEmailMissedCalls", "VMEnabled", "VMEmailOptions", "VMPlayCallerID",
    "VMPlayMsgDateTime", "MyPhonePush", "MyPhoneShowRecordings", "MyPhoneAllowDeleteRecordings",
    "MyPhoneHideForwardings", "HideInPhonebook", "CallScreening", "AllowLanOnly", "BlockTunnel",
    "SRTPMode", "PbxDeliversAudio", "Internal", "PinProtected", "PinProtectTimeout",
    "MS365SignInEnabled", "MS365ContactsEnabled", "MS365CalendarEnabled", "MS365TeamsEnabled",
    "GoogleSignInEnabled", "GoogleContactsEnabled", "GoogleCalendarEnabled",
    // Ce qui fait la conformité d'un poste à son équipe : département principal,
    // horaires, pause, et les réglages d'appel et de visioconférence.
    "PrimaryGroupId", "Hours", "BreakTime", "TranscriptionMode", "CallUsRequirement",
    "CallUsEnablePhone", "CallUsEnableChat", "CallUsEnableVideo",
    "WebMeetingApproveParticipants", "VMDisablePinAuth", "DatevEnabled",
];

let base = "", jeton = "";

async function api(methode: string, chemin: string, corps?: unknown) {
    const r = await fetch(`${base}/xapi/v1/${chemin}`, {
        method: methode,
        headers: { Authorization: `Bearer ${jeton}`, ...(corps ? { "Content-Type": "application/json" } : {}) },
        body: corps ? JSON.stringify(corps) : undefined,
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${txt.slice(0, 400)}`);
    try { return txt ? JSON.parse(txt) : null; } catch { return txt; }
}

function titre(t: string) { console.log(`\n${"─".repeat(70)}\n${t}\n${"─".repeat(70)}`); }

async function main() {
    const cfg = await getServerXapiConfig("gerofinance" as never);
    if (!cfg.baseUrl || !cfg.clientId || !cfg.key) return console.log("XAPI indisponible pour ce tenant.");
    base = cfg.baseUrl;
    jeton = (await (await fetch(`${base}/connect/token`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId, client_secret: cfg.key }),
    })).json()).access_token;
    console.log(`PBX ${base} · modèle : poste ${MODELE} · mode : ${GO ? "ÉCRITURE (le poste d'essai sera supprimé)" : "LECTURE SEULE"}`);

    // ---------------------------------------------------------------- 1
    titre("1. Le modèle, tel qu'on le lirait");
    const m = (await api("GET", `Users?%24filter=Number%20eq%20'${MODELE}'&%24expand=ForwardingProfiles,ForwardingExceptions`)).value?.[0];
    if (!m) throw new Error(`poste ${MODELE} introuvable`);
    console.log(`  ${m.Number} — ${m.DisplayName} · département principal ${m.PrimaryGroupId}`);
    console.log(`  profils de renvoi : ${(m.ForwardingProfiles ?? []).length} · exceptions : ${(m.ForwardingExceptions ?? []).length} · BLF : ${(String(m.Blfs).match(/<BLF /g) ?? []).length} touches`);
    // $top est plafonné à 100 par le PBX : on pagine.
    const groupes: any[] = [];
    for (let saut = 0; saut < 1000; saut += 100) {
        const lot = (await api("GET", `Groups?%24expand=Members&%24top=100&%24skip=${saut}`)).value ?? [];
        groupes.push(...lot);
        if (lot.length < 100) break;
    }
    const sesGroupes = groupes.filter((g: any) => (g.Members ?? []).some((x: any) => x.Number === MODELE));
    console.log(`  départements : ${sesGroupes.length} → ${sesGroupes.map((g: any) => g.Name).join(", ") || "aucun"}`);

    // ---------------------------------------------------------------- 2
    titre("2. La charge qu'une copie enverrait");
    const copie: Record<string, unknown> = {};
    for (const k of A_COPIER) if (m[k] !== undefined && m[k] !== null) copie[k] = m[k];
    copie.ForwardingProfiles = (m.ForwardingProfiles ?? []).map((p: any) => {
        const { Id, ...reste } = p;   // l'identifiant appartient au modèle
        return reste;
    });
    const ignores = Object.keys(m).filter((k) => !(k in copie) && m[k] !== null && m[k] !== "" && !Array.isArray(m[k]));
    console.log(`  ${Object.keys(copie).length} champs repris · ${(copie.ForwardingProfiles as any[]).length} profils`);
    console.log(`  volontairement écartés : ${ignores.filter((k) => JAMAIS_COPIE.has(k)).join(", ")}`);
    const surprise = ignores.filter((k) => !JAMAIS_COPIE.has(k));
    if (surprise.length) console.log(`  ⚠ ni repris ni écartés explicitement, à trancher : ${surprise.join(", ")}`);

    // ---------------------------------------------------------------- 3
    titre("3. Le numéro libre que le PBX propose");
    let libre = "";
    try {
        const r = await api("GET", "Users/Pbx.GetFirstAvailableExtensionNumber()");
        libre = String(r?.Number ?? "");
        console.log(`  GetFirstAvailableExtensionNumber → ${libre || JSON.stringify(r)}`);
    } catch (e) { console.log(`  fonction indisponible : ${(e as Error).message.slice(0, 160)}`); }
    if (!GO) { console.log("\nLecture seule : rien n'a été écrit. Relancer avec --go pour l'essai complet."); return; }
    if (!libre) throw new Error("pas de numéro libre proposé, on n'invente pas un numéro sur un PBX de production");

    // ---------------------------------------------------------------- 4
    let cree: any = null;
    try {
        titre(`4. Création du poste d'essai ${libre}`);
        cree = await api("POST", "Users", {
            Number: libre, FirstName: MARQUEUR, LastName: "à supprimer",
            DisplayName: `${MARQUEUR} — à supprimer`, Enabled: false,
        });
        console.log(`  créé : Id=${cree.Id} Number=${cree.Number} « ${cree.DisplayName} »`);

        titre("5. Copie de la configuration du modèle");
        // Le département principal ne s'accepte qu'une fois le poste membre du
        // département : on le met de côté pour l'étape 6.
        const { PrimaryGroupId, ...sansDepartement } = copie as any;
        await api("PATCH", `Users(${cree.Id})`, sansDepartement);
        const relu = (await api("GET", `Users(${cree.Id})?%24expand=ForwardingProfiles`));
        const verdict = (nom: string, ok: boolean, detail = "") => console.log(`  ${ok ? "✓" : "✗"} ${nom}${detail ? ` — ${detail}` : ""}`);
        verdict("BLF", String(relu.Blfs).match(/<BLF /g)?.length === String(m.Blfs).match(/<BLF /g)?.length,
            `${(String(relu.Blfs).match(/<BLF /g) ?? []).length} touches sur ${(String(m.Blfs).match(/<BLF /g) ?? []).length}`);
        verdict("profils de renvoi", (relu.ForwardingProfiles ?? []).length === (m.ForwardingProfiles ?? []).length,
            `${(relu.ForwardingProfiles ?? []).length} sur ${(m.ForwardingProfiles ?? []).length}`);
        const dispoM = (m.ForwardingProfiles ?? []).find((p: any) => p.Name === "Available");
        const dispoC = (relu.ForwardingProfiles ?? []).find((p: any) => p.Name === "Available");
        verdict("délai de non-réponse", dispoC?.NoAnswerTimeout === dispoM?.NoAnswerTimeout, `${dispoC?.NoAnswerTimeout} vs ${dispoM?.NoAnswerTimeout}`);
        verdict("destination de non-réponse", JSON.stringify(dispoC?.AvailableRoute?.NoAnswerInternal) === JSON.stringify(dispoM?.AvailableRoute?.NoAnswerInternal),
            JSON.stringify(dispoC?.AvailableRoute?.NoAnswerInternal ?? null).slice(0, 90));
        verdict("langue", relu.Language === m.Language, `${relu.Language}`);

        titre("6. Rattachement à un département, avec les droits");
        // Le département PRINCIPAL du modèle : c'est là qu'il porte de vrais
        // droits, et c'est le seul qu'on pourra ensuite désigner comme principal.
        const cible = sesGroupes.find((g: any) => g.Id === m.PrimaryGroupId) ?? sesGroupes[0];
        if (!cible) console.log("  le modèle n'appartient à aucun département : rien à essayer");
        else {
            // Les droits ne viennent QUE si on les demande : $expand=Members($expand=Rights).
            const avant = await api("GET", `Groups(${cible.Id})?%24expand=Members(%24expand%3DRights)`);
            const sien = (avant.Members ?? []).find((x: any) => x.Number === MODELE);
            const membres = [...cible.Members.map((x: any) => ({ Number: x.Number })), { Number: libre }];
            try {
                await api("PATCH", `Groups(${cible.Id})`, { Members: membres });
                const relu2 = await api("GET", `Groups(${cible.Id})?%24expand=Members(%24expand%3DRights)`);
                const moi = (relu2.Members ?? []).find((x: any) => x.Number === libre);
                console.log(`  ${moi ? "✓" : "✗"} ajouté à « ${cible.Name} » (${(relu2.Members ?? []).length} membres)`);
                console.log(`     droits du modèle : ${JSON.stringify(sien?.Rights ?? null)}`);
                console.log(`     droits obtenus   : ${JSON.stringify(moi?.Rights ?? null)}`);
                // Maintenant que le poste est membre, le département principal passe-t-il ?
                try {
                    await api("PATCH", `Users(${cree.Id})`, { PrimaryGroupId: (copie as any).PrimaryGroupId ?? cible.Id });
                    const u3 = await api("GET", `Users(${cree.Id})?%24select=PrimaryGroupId`);
                    console.log(`  ✓ département principal posé après rattachement : ${u3.PrimaryGroupId}`);
                } catch (e) { console.log(`  ✗ département principal refusé même après rattachement : ${(e as Error).message.slice(0, 240)}`); }
                // Et les droits : peut-on les écrire sur la ligne du membre ?
                try {
                    const avecDroits = (relu2.Members ?? []).map((x: any) => (x.Number === libre && sien?.Rights)
                        ? { Number: x.Number, Rights: sien.Rights } : { Number: x.Number });
                    await api("PATCH", `Groups(${cible.Id})`, { Members: avecDroits });
                    const relu3 = await api("GET", `Groups(${cible.Id})?%24expand=Members(%24expand%3DRights)`);
                    const apres = (relu3.Members ?? []).find((x: any) => x.Number === libre);
                    console.log(`  ${JSON.stringify(apres?.Rights) === JSON.stringify(sien?.Rights) ? "✓" : "✗"} droits recopiés : ${JSON.stringify(apres?.Rights ?? null)}`);
                } catch (e) { console.log(`  ✗ écriture des droits refusée : ${(e as Error).message.slice(0, 240)}`); }
            } catch (e) { console.log(`  ✗ ajout au département refusé : ${(e as Error).message.slice(0, 300)}`); }
        }
    } finally {
        if (cree?.Id) {
            titre("7. Nettoyage");
            try { await api("DELETE", `Users(${cree.Id})`); console.log(`  poste d'essai ${cree.Number} supprimé.`); }
            catch (e) { console.log(`  ⚠ SUPPRESSION ÉCHOUÉE, à faire à la main : poste ${cree.Number} (Id ${cree.Id}) — ${(e as Error).message.slice(0, 200)}`); }
        }
    }
}

main().catch((e) => { console.error("\nÉCHEC :", e.message); process.exit(1); });
