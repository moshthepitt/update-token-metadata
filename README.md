# Update Metaplex Token Metadata

This is a super simple utility to update [metaplex token metadata](https://docs.metaplex.com/programs/token-metadata/overview).

However, before you go ahead and use this, you probably want to give [Metaboss](https://metaboss.rs/) a try, because:

- Metaboss is much more complete
- This utility was made to cover very specific edge-cases that Metaboss does not cover.

What edge cases?  This utility is great at bulk updating token metadata royalties, and creators.

## How to use

1. Clone this repo
2. Install dependencies `npm i` or `yarn`
3. Run the update command e.g. `npm run update "/tmp/hash.json" 755`
