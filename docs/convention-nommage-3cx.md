# Convention de nommage 3CX — files d'attente et départements

*Établie le 6 août 2026, sur l'inventaire des 97 files actives (90 jours d'appels).
Arbitrages : GRR/GD/RR/RC = une seule entité **GRR** ; trois réceptions (Pully,
Genève — l'actuel « Service Client » —, Coppet) ; BCR = autre entité, hors
périmètre ; Veladzo = projet, hors périmètre ; Private Office ⊂ BS.*

---

## 1. La grammaire

### Files : `ENTITÉ SITE Service Détail`

| Segment | Règle |
|---|---|
| **ENTITÉ** | Code fixe MAJUSCULES : `GRR` (régie), `BS` (Barnes), `BCR` (hors périmètre) |
| **SITE** | Ville complète, MAJUSCULES **sans accent** : `GENEVE`, `PULLY`, `VEVEY`, `SION`, `BULLE`, `NEUCHATEL`, `COPPET`, `NYON`, `ZURICH`, `LAUSANNE`, `MONTREUX`, `MORGES`, `YVERDON`, `FRIBOURG`, `CRANS-MONTANA`, `ZERMATT`, `LUTRY` |
| **Service** | Vocabulaire contrôlé, singulier : `Réception`, `Gérance`, `PPE`, `Location`, `Comptabilité`, `Ventes`, `IT`, `Direction`, `Juridique`, `Contentieux`, `RH`, `Marketing`, `Qualité`, `Finance`, `Assurances`, `Commercial`, `Private Office`, `Promotion`, `Services Généraux` |
| **Détail** | Compact, en fin de nom : bureaux `B503`/`RDC`/`G21`, cellules `63`, équipes `2`, sites annexes `Etang`, et `Débordement` toujours en dernier mot |

Longueur cible ≤ 32 caractères. Pas de parenthèses, pas de « Groupe » en préfixe.

### Départements : le nom de file **moins le détail**

Règle mécanique : toutes les `GRR GENEVE Gérance B5xx` → département
`GRR GENEVE Gérance`. Le département est l'unité d'HORAIRES (bureau fermé,
pauses, fériés) et la future unité de PÉRIMÈTRE de droits — zéro ambiguïté,
dérivable automatiquement.

### Les trois garde-fous

1. **On renomme, on ne renumérote JAMAIS** — le numéro est l'identité d'une
   file dans tout l'historique statistique.
2. **Ne plus créer de groupes d'appel ni de scripts** (en cours de retrait).
3. Après renommage, rafraîchir les étiquettes entité/région dans
   Réglages ▸ Files d'attente (les étiquettes validées ne sont pas écrasées
   automatiquement — les ex-RC porteront encore `RC`).

---

## 2. Table de renommage complète, par département cible

⚑ = point à trancher avant de renommer.

### GRR GENEVE Réception
| N° | Actuel | Proposé |
|---|---|---|
| 958 | RR GENEVE Service Client | **GRR GENEVE Réception** |
| 600 | GRR GENEVE Accueil 6e | **GRR GENEVE Réception 6e** |
| 994 | GRR GENEVE Accueil Etang RDC | **GRR GENEVE Réception Etang** ⚑ (rattachée à la réception ou à l'Etang ?) |

### GRR GENEVE Gérance
| N° | Actuel | Proposé |
|---|---|---|
| 946 | GRR GENEVE Gérance (RDC) | **GRR GENEVE Gérance RDC** |
| 948 | GRR GENEVE Gérance (Bureau 503) | **GRR GENEVE Gérance B503** |
| 981 | GRR GENEVE Gérance (Bureau 504) | **GRR GENEVE Gérance B504** |
| 947 | GRR GENEVE Gérance (Bureau 507) | **GRR GENEVE Gérance B507** |
| 982 | GRR GENEVE Gérance (Bureau 509) | **GRR GENEVE Gérance B509** ⚑ (1 passage en 90 j — archiver ?) |
| 969 | GRR GENEVE Gérance (Bureau 510) | **GRR GENEVE Gérance B510** |
| 968 | GRR GENEVE Gérance (Bureau 511) | **GRR GENEVE Gérance B511** |
| 945 | GRR GENEVE Gérance (Bureau 512) | **GRR GENEVE Gérance B512** |
| 971 | GRR GENEVE Gérance (Bureau 513) | **GRR GENEVE Gérance B513** |
| 899 | GRR GENEVE Gérance (Bureau 517) | **GRR GENEVE Gérance B517** |
| 972 | GRR GENEVE Gérance (Bureau 518) | **GRR GENEVE Gérance B518** |
| 974 | GRR GENEVE Gérance (Bureau 519) | **GRR GENEVE Gérance B519** |
| 970 | GRR GENEVE Gérance (Bureau 520) | **GRR GENEVE Gérance B520** |
| 884 | GRR GENEVE Gérance GE-G21 | **GRR GENEVE Gérance G21** |
| 977 | GRR GENEVE Lots Isolés | **GRR GENEVE Gérance Lots Isolés** (son département observé est déjà la Gérance) |
| 896 | GRR GENEVE Valorisation Energie et Reno | **GRR GENEVE Gérance Valorisation** ⚑ (ou service autonome `GRR GENEVE Valorisation`) |

### GRR GENEVE PPE
| N° | Actuel | Proposé |
|---|---|---|
| 926 | GRR GENEVE PPE 1 | conforme |
| 895 | GRR GENEVE PPE 2 | conforme |
| 897 | GRR GENEVE PPE 3 | conforme |
| 889 | GRR GENEVE PPE 4 | conforme |
| 980 | GRR GENEVE PPE 6 | conforme |
| 979 | GRR GENEVE PPE 7 | conforme |

### GRR GENEVE Comptabilité
| N° | Actuel | Proposé |
|---|---|---|
| 934 | GRR GENEVE Comptabilité Gérance | conforme |
| 928 | GRR GENEVE Comptabilité Copropriétés | **GRR GENEVE Comptabilité PPE** ⚑ (Copropriétés = PPE ? aligne sur Pully) |
| 964 | GRR GENEVE Comptabilité Fournisseurs | conforme |
| 966 | RR GENEVE Compta PPE | ⚑ fusionner avec la 928 (2 passages en 90 j) |
| 935 | GRR GENEVE Finance | **GRR GENEVE Comptabilité Finance** ⚑ (ou département Finance autonome) |

### GRR GENEVE Location
| N° | Actuel | Proposé |
|---|---|---|
| 949 | GRR GENEVE Location Résidentielles | **GRR GENEVE Location** |
| 940 | RR GENEVE Location | ⚑ doublon probable de la 949 (7 passages) — fusionner/archiver |

### GRR GENEVE IT
| N° | Actuel | Proposé |
|---|---|---|
| 688 | GRR GENEVE IT | conforme |
| 806 | GRR GENEVE Quorum | **GRR GENEVE IT Quorum** |
| 978 | GRR Admins IT | **GRR GENEVE IT Admins** |

### GRR GENEVE Direction
| N° | Actuel | Proposé |
|---|---|---|
| 967 | GRR Direction | **GRR GENEVE Direction** |
| 046 | GRR Direction Gérance | **GRR GENEVE Direction Gérance** ⚑ (fusion avec la 967 ?) |

### GRR GENEVE Juridique
| N° | Actuel | Proposé |
|---|---|---|
| 975 | GRR GENEVE Juridique | conforme |
| 936 | GRR GENEVE Contentieux | conforme ⚑ (département propre « Contentieux » — 712 passages — ou sous Juridique ?) |

### GRR GENEVE — petits services ⚑ *arbitrage global*
*Option A : chacun son département (granularité de droits maximale).
Option B : un département commun `GRR GENEVE Administration` (moins d'horaires
à maintenir). Les noms de files restent identiques dans les deux cas.*
| N° | Actuel | Proposé |
|---|---|---|
| 942 | GRR GENEVE RH | conforme |
| 869 | GRR Genève Marketing | **GRR GENEVE Marketing** |
| 822 | GRR Genève Qualité | **GRR GENEVE Qualité** |
| 880 | GRR Assurances Fournisseurs | **GRR GENEVE Assurances** ⚑ (site à confirmer) |
| 960 | GRR GENEVE Évolution Loyers | conforme (ou **GRR GENEVE Loyers**) |
| 991 | GRR GENEVE Service Généraux | **GRR GENEVE Services Généraux** |

### GRR PULLY
| N° | Actuel | Proposé |
|---|---|---|
| 900 | RC PULLY Réception | **GRR PULLY Réception** |
| 904 | RC PULLY Gérance | **GRR PULLY Gérance** |
| 905 | RC PULLY Gérance Résidentielle | **GRR PULLY Gérance Résidentielle** |
| 993 | RR PULLY Gérance 63 | **GRR PULLY Gérance 63** |
| 995 | RR PULLY Gérance 65 | **GRR PULLY Gérance 65** |
| 903 | RC PULLY PPE | **GRR PULLY PPE** |
| 092 | RC PULLY Comptabilité PPE | **GRR PULLY Comptabilité PPE** |
| 093 | RC PULLY Comptabilité Gérance | **GRR PULLY Comptabilité Gérance** |
| 094 | RC PULLY Comptabilité Fournisseurs | **GRR PULLY Comptabilité Fournisseurs** |
| 902 | RC PULLY Comptabilité | ⚑ 1 passage en 90 j — archiver ? |
| 956 | RC Pully Location Résidentielles | **GRR PULLY Location** |
| 906 | GRR PULLY IT | conforme |

### GRR COPPET ⚑ *un seul département de site (horaires communs), ou par service ?*
| N° | Actuel | Proposé |
|---|---|---|
| 950 | GD COPPET Principal | **GRR COPPET Réception** |
| 937 | GD COPPET Gérance | **GRR COPPET Gérance** |
| 951 | GD COPPET Gérance débordement | **GRR COPPET Gérance Débordement** † |
| 927 | GD COPPET PPE | **GRR COPPET PPE** |
| 952 | GD COPPET PPE débordement | **GRR COPPET PPE Débordement** † |
| 944 | GD COPPET Location Résidentielle | **GRR COPPET Location** |
| 953 | GD COPPET Location Résidentielle débordement | **GRR COPPET Location Débordement** † |

† Files de débordement : en sursis — la migration groupes/scripts pourrait les
rendre inutiles (le débordement se configure sur la file principale).

### GRR — sites mono-file
| N° | Actuel | Proposé |
|---|---|---|
| 901 | RC VEVEY Gérance | **GRR VEVEY Gérance** |
| 910 | RC SION Gérance | **GRR SION Gérance** |
| 925 | RC BULLE Gérance | **GRR BULLE Gérance** |
| 807 | RC NEUCHATEL Gérance | **GRR NEUCHATEL Gérance** |
| 933 | GD NYON Gérance | **GRR NYON Gérance** |
| 133 | GD Zurich | **GRR ZURICH Gérance** |

### BS (Barnes)
| N° | Actuel | Proposé |
|---|---|---|
| 923 | BS GENEVE Ventes | conforme |
| 939 | BS GENEVE Ventes 2 | conforme |
| 922 | BS Etang Barnes | **BS GENEVE Ventes Etang** |
| 959 | BS GENEVE Développement et Promotion | **BS GENEVE Promotion** |
| 943 | BS GENEVE Marketing | conforme |
| 838 | Barnes Commercial | **BS GENEVE Commercial** ⚑ (site à confirmer) |
| 914 | Private Office | **BS GENEVE Private Office** |
| 860 | BS LAUSANNE Ventes | conforme |
| 957 | BS LAUSANNE Ventes 2 | conforme |
| 913 | BS MONTREUX Ventes | conforme |
| 924 | BS MONTREUX Ventes 2 | conforme |
| 915 | BS MORGES Ventes | conforme |
| 916 | BS YVERDON Ventes | conforme |
| 917 | BS FRIBOURG Ventes | conforme |
| 918 | BS SION Ventes | conforme |
| 919 | BS CRANS-MONTANA Ventes | conforme |
| 921 | BS NYON Ventes | conforme |
| 961 | BS NEUCHATEL Ventes | conforme |
| 890 | BS ZERMATT Ventes | conforme |
| 820 | Groupe BS Lutry Ventes | **BS LUTRY Ventes** |
| 997 | BS BULLE Ventes | conforme |

### Hors périmètre (ne pas toucher)
| N° | Actuel | Raison |
|---|---|---|
| 134, 136, 138, 150, 160 | BCR Groupe … | Autre entité |
| 815 | Veladzo | Projet |

---

## 3. Les départements cible (~24)

`GRR GENEVE` : Réception · Gérance · PPE · Comptabilité · Location · IT ·
Direction · Juridique · (petits services : option A par service / option B
`Administration`) — `GRR PULLY` : Réception · Gérance · PPE · Comptabilité ·
Location · IT — `GRR COPPET` (1 ou 4, à trancher) — `GRR VEVEY/SION/BULLE/
NEUCHATEL/NYON/ZURICH Gérance` — `BS <VILLE> Ventes` par site + `BS GENEVE
Marketing/Commercial/Private Office`.

À purger des départements existants : `Total`, `Veladzo département`, les
départements-doublons de cellule (`RR Pully Gérance 63`, `RR Genève Gérance
10/25`…) — une cellule est un DÉTAIL de file, pas un département.

---

## 4. Mode opératoire

1. Renommer **par vagues** (un département cible à la fois) ; l'application
   suit toute seule (~5 min), marque « (renommée) » dans le registre et
   conserve l'historique des noms — les journaux gardent le nom d'époque.
2. Après chaque vague : rafraîchir les étiquettes entité/région du registre,
   vérifier le sous-titre « Département » et la carte de parcours.
3. Créer/renommer les départements 3CX avec leurs horaires AVANT de basculer
   les scripts d'horaires (prérequis de la migration groupes/scripts).
4. Les ⚑ se tranchent au fil de l'eau — aucun ne bloque le démarrage.
