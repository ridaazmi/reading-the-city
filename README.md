# Reading the City — démo web du prototype GeoAI Morpho-Risque

Application web **statique** qui rejoue les résultats pré-calculés du notebook
`GeoAI_Demo_Morpho_Risque_Rue.ipynb` pour les évaluateurs de Cities Deliver et pour la Ville de Kinshasa.
Aucun GPU, aucun modèle, aucun jeton n'est utilisé en ligne : seul le scénario de pluie (SCS-CN + HAND) est
recalculé dans le navigateur, avec la même formule que `geoai_frugal/restitution.py`.

Interface en anglais (évaluateurs) avec bascule en français (ville). Les textes produits par le VLM restent en
français et sont étiquetés « AI-generated ».

## Pages

| Onglet | Contenu |
| --- | --- |
| Overview | KPI du quartier, répartition des classes de risque, comparaison des 4 quartiers |
| Explore blocks | Carte des îlots (risque, vulnérabilité perçue par l'IA, audit) ; fiche par îlot : 5 images, lecture du VLM, décomposition du score, indicateurs |
| Sky vs street | Accord ciel / rue et corrections apportées par les photos Mapillary |
| Rainfall scenario | Curseur 0–200 mm, état du sol, hypothèse h100 ; bâtiments et habitants touchés ; lien vers la vue 3D et la planche A3 |
| Reliability & limits | Indicateurs de validation (mêmes définitions que `morpho_risque.validation`), limites, ce que le pilote mesurera |
| Method & responsible AI | Chaîne, formule, garde-fous, sources |

## Quartiers inclus

| id | Run du notebook | Quartier | Vue de rue |
| --- | --- | --- | --- |
| `immo_congo` | `v4rue_b22` | Immo-Congo, Kalamu | oui |
| `croix_rouge` | `v4rue_croix_rouge_gombe_b70` | Croix-Rouge, Gombe | oui |
| `industriel` | `v4_b21` | Industriel, Limete | non |
| `onl` | `v4_b24` | ONL, Kasa-Vubu | non |

Pour ajouter un quartier : relancer le notebook, puis ajouter une ligne à `RUNS` dans `build_data.py`.

## Mettre à jour les données

Le script lit le dossier `outputs/` du projet SAM3hybrid **en lecture seule** et écrit dans `site/data/`.

```bash
python build_data.py --src D:/SAM3hybrid/outputs
```

Dépendances : `geopandas`, `pyogrio`, `scipy`, `Pillow`. L'option `--with-photos` copie les photos Mapillary dans le
site ; sans elle, l'app ne montre que des liens vers mapillary.com (règle du notebook : « citer, ne pas republier »).

## Lancer en local

```bash
node serve.js
```

(ou `python -m http.server 8765 --directory site`). Puis ouvrir http://localhost:8765. Le site fonctionne aussi en ouvrant directement `site/index.html` (les données
sont des fichiers `.js`, pas des `fetch`).

## Mettre en ligne

Le site est publié sur GitHub Pages par `.github/workflows/pages.yml` : chaque `git push` sur `main` redéploie le
dossier `site/` à la même adresse. Pour ajouter un quartier : relancer le notebook, ajouter la ligne dans `RUNS`,
`python build_data.py`, puis `git add -A && git commit -m "Ajout quartier X" && git push`.

Le dossier `site/` se publie aussi tel quel sur Netlify ou tout hébergement statique. Avant chaque mise en ligne
**publique**, vérifier :

- les conditions d'usage d'Esri World Imagery (fond de carte et vignettes `*_tuile.jpg`) ;
- la licence des photos Mapillary (CC BY-SA 4.0 : attribution et partage à l'identique) si `--with-photos` ;
- qu'aucune donnée municipale non publique n'est incluse ; sinon, protéger le lien par mot de passe.

## Structure

```
build_data.py      export des runs vers site/data/
serve.js           serveur local sans dépendance (node serve.js)
logos/             logo source
.github/workflows/ publication GitHub Pages
site/index.html    page unique
site/css/app.css   styles (thème clair ; palettes de risque et de profondeur validées)
site/js/i18n.js    textes EN / FR et libellés des codes du pipeline
site/js/app.js     logique : cartes Leaflet, fiches, scénario de pluie, page contact
site/img/          logo affiché dans l'en-tête
site/data/<id>/    data.js (îlots, bâtiments, KPI, lectures du VLM), img/, vue3d.html, planche.jpg
```
