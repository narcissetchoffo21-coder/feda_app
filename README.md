# FEDA — application indépendante

FEDA est une application web progressive (PWA) de vidéos courtes. Elle fonctionne sur téléphone et ordinateur, possède ses propres comptes e-mail/mot de passe et ne demande pas de compte ChatGPT.

## Ce qui fonctionne

- inscription et connexion FEDA ;
- vidéos verticales plein écran ;
- fils **Pour toi**, **Nouveautés** et **Abonnements** ;
- publication de vidéos MP4/WebM/MOV jusqu’à 50 Mo sur l’offre gratuite, avec envoi découpé et reprise automatique sur les connexions mobiles ;
- limites prévues : 100 Mo après activation de l’offre Pro, puis 1 Go lors de la sortie du palier Pro 1 Go ;
- likes, commentaires, abonnements, partage et recherche ;
- boîte de réception et notifications ;
- signalement des contenus ;
- FedaCoins, cadeaux, abonnements créateurs et revenus ;
- demandes d’achat par MTN MoMo/Orange Money ;
- demandes de retrait par MTN MoMo/Orange Money ;
- installation comme application sur Android, iPhone et ordinateur.

## Base de données déjà configurée

Le projet est relié au projet Supabase **FEDA** :

- URL : `https://vrtordouhavvdxjykkuy.supabase.co`
- configuration publique : `config.js`
- stockage vidéo privé avec liens temporaires ;
- sécurité RLS activée sur toutes les tables ;
- calcul des soldes côté serveur : un utilisateur ne peut pas modifier son solde lui-même.

La clé placée dans `config.js` est une clé **publique** prévue pour les applications clientes. Ne placez jamais une clé `service_role` dans ces fichiers.

## Tester sur un ordinateur

Il faut servir le dossier avec un serveur HTTP (ne pas ouvrir simplement `index.html` comme un fichier) :

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.

## Mettre FEDA en ligne

Le dossier est statique et peut être publié sur GitHub Pages, Cloudflare Pages, Netlify ou Vercel. Pour GitHub Pages :

1. créer un dépôt GitHub nommé `feda-app` ;
2. déposer tous les fichiers de ce dossier à la racine ;
3. ouvrir **Settings → Pages** ;
4. choisir **Deploy from a branch**, branche `main`, dossier `/root` ;
5. ajouter l’URL finale dans Supabase : **Authentication → URL Configuration → Site URL**.

## Installation sur téléphone

Une fois le site publié en HTTPS :

- Android/Chrome : menu ⋮ → **Installer l’application** ;
- iPhone/Safari : bouton Partager → **Sur l’écran d’accueil** ;
- ordinateur/Chrome ou Edge : icône **Installer** dans la barre d’adresse.

## Publication Google Play

La PWA pourra être emballée comme application Android avec Trusted Web Activity ou Capacitor. Avant l’envoi sur Google Play, il faudra :

1. une URL HTTPS définitive et un nom de domaine ;
2. un compte Google Play Console ;
3. des icônes PNG 512×512 et captures d’écran ;
4. une politique de confidentialité publique ;
5. une déclaration sur la modération des contenus générés par les utilisateurs ;
6. remplacer, dans la version distribuée par Google Play, l’achat Mobile Money des FedaCoins par Google Play Billing (ou adhérer à un programme de facturation alternative applicable au pays).

## Paiements Mobile Money

La version web actuelle utilise une validation manuelle : le spectateur paie par MTN MoMo ou Orange Money, saisit sa référence, puis un administrateur valide la commande. Pour une confirmation automatique, il faudra obtenir des identifiants marchands officiels MTN/Orange et les connecter à une fonction serveur. Ne mettez jamais ces secrets dans `config.js`.

Important : Google considère les monnaies virtuelles comme des biens numériques. Une application téléchargée depuis Google Play doit donc normalement utiliser Google Play Billing pour vendre les FedaCoins. Le paiement Mobile Money direct peut rester sur le site web, mais ne doit pas être présenté tel quel dans l’application Play Store sauf programme d’exception ou de facturation alternative applicable.

## Première administration

Après avoir créé votre propre compte FEDA, son rôle doit être changé une seule fois en `admin` depuis le tableau de bord Supabase. Ensuite, l’administrateur peut valider les achats de coins et les retraits au moyen des fonctions sécurisées déjà installées.

## Structure

- `index.html` : écrans et composants ;
- `styles.css` : apparence téléphone/ordinateur ;
- `app.js` : interactions et interface ;
- `api.js` : connexion sécurisée à Supabase ;
- `vendor/tus.min.js` : envoi vidéo résumable (TUS), nécessaire pour les vidéos de plus de 6 Mo ;
- `config.js` : URL et clé publique ;
- `manifest.webmanifest` et `sw.js` : installation PWA ;
- `assets/feda-logo.svg` : logo FEDA.
