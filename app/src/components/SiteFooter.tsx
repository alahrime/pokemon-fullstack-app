/**
 * Attribution and disclaimer.
 *
 * Not decoration. Two of the dependencies are MIT licensed — PvPoke's game
 * data and the type icons — and MIT asks that the notice travel with the
 * distribution. A deployed web app is a distribution, so crediting them only
 * in the repo's README does not discharge it.
 *
 * The disclaimer matters for a different reason: fan tools in this space run
 * on the rights holders' tolerance, and stating plainly that this is
 * unofficial, unaffiliated and free is both honest and the norm every
 * long-running Pokémon fan site follows.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer-line">
        <strong>Paragon/IV</strong> is a free, non-commercial tool for learning Pokémon GO PvP. It is
        unofficial and not affiliated with, endorsed by, or sponsored by Niantic, The Pokémon
        Company, or Nintendo. Pokémon and all related names are trademarks of their respective
        owners, used here only to describe the game.
      </p>
      <p className="site-footer-line">
        Game data from{' '}
        <a href="https://github.com/pvpoke/pvpoke" target="_blank" rel="noreferrer noopener">
          PvPoke
        </a>{' '}
        (MIT). Type icons from{' '}
        <a href="https://github.com/partywhale/pokemon-type-icons" target="_blank" rel="noreferrer noopener">
          partywhale/pokemon-type-icons
        </a>{' '}
        (MIT). Sprites from{' '}
        <a href="https://pokemondb.net/" target="_blank" rel="noreferrer noopener">
          PokémonDB
        </a>
        ,{' '}
        <a href="https://github.com/PokeAPI/sprites" target="_blank" rel="noreferrer noopener">
          PokeAPI
        </a>{' '}
        and{' '}
        <a href="https://github.com/PokeMiners/pogo_assets" target="_blank" rel="noreferrer noopener">
          PokeMiners
        </a>
        .
      </p>
    </footer>
  );
}
