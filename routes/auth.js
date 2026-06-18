const express = require('express');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const router = express.Router();

if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
  console.warn('[auth] DISCORD_CLIENT_ID o DISCORD_CLIENT_SECRET no configurados. Copia .env.example a .env y completa las credenciales.');
} else {
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify']
  }, (_accessToken, _refreshToken, profile, done) => {
    const user = {
      id: profile.id,
      name: profile.global_name || profile.username,
      image: profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(profile.discriminator || 0) % 5}.png`
    };
    return done(null, user);
  }));
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

router.get('/discord', passport.authenticate('discord'));

router.get('/callback',
  passport.authenticate('discord', { failureRedirect: '/?login=error' }),
  (req, res) => {
    const dest = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    res.redirect(dest);
  }
);

router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

module.exports = router;
