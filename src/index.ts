/**
 * This command reveals updates royalty percentages for mutable NFTs
 *
 * TO RUN:
 *      npm run update {path to hash file} {new royalty amount} {new creator address};{new creator share}
 *
 * The data file is a JSON file that looks like this:
 *      [mint1, mint2, mint3...]
 */
import fs from "fs";
import { assert } from "console";
import * as anchor from "@project-serum/anchor";
import { getMultipleAccounts } from "@project-serum/anchor/dist/cjs/utils/rpc";
import {
  Creator,
  Metadata,
  createUpdateMetadataAccountV2Instruction,
  UpdateMetadataAccountV2InstructionArgs,
} from "@metaplex-foundation/mpl-token-metadata";

const RPC_URL = "https://api.devnet.solana.com";
const WALLET = "~/.config/solana/id.json";

const hashFileInput = process.argv[2];
const royalty = process.argv[3];
const creator = process.argv[4];
if (hashFileInput === undefined) {
  throw new Error("The hash file is not defined");
}

const mintAddresses: string[] = JSON.parse(
  fs.readFileSync(hashFileInput, "utf8")
);

let newCreator: Creator | null = null;
if (creator) {
  const creatorArray = creator.split(";");
  const creatorAddress = creatorArray[0];
  const creatorShare = parseInt(creatorArray[1]);
  newCreator = {
    address: new anchor.web3.PublicKey(creatorAddress),
    share: creatorShare,
    verified: false,
  };
}

const MAX_IX = 10;
const SLEEP_TIME = 100;

// RPC URL and connection
const confirmTransactionInitialTimeout =
  120 *
  1000; /** time to allow for the server to initially process a transaction (in milliseconds) */
const providerUrl = RPC_URL;
if (providerUrl === undefined) {
  throw new Error("ANCHOR_PROVIDER_URL is not defined");
}
const providerOptions = {
  preflightCommitment: "processed" as anchor.web3.Commitment,
  commitment: "processed" as anchor.web3.Commitment,
};
const providerConnection = new anchor.web3.Connection(providerUrl, {
  commitment: providerOptions.commitment,
  confirmTransactionInitialTimeout,
});
const provider = new anchor.AnchorProvider(
  providerConnection,
  new anchor.Wallet(
    anchor.web3.Keypair.fromSecretKey(
      Buffer.from(JSON.parse(fs.readFileSync(WALLET, "utf8")))
    )
  ),
  providerOptions
);

/** Break an array into chunks */
export function chunks<T>(array: T[], size: number): T[][] {
  return Array.apply<number, T[], T[][]>(
    0,
    new Array(Math.ceil(array.length / size))
  ).map((_, index) => array.slice(index * size, (index + 1) * size));
}

/** Sleep for given time period */
export const sleep = (ms: number): Promise<unknown> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const METAPLEX = new anchor.web3.PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

/** Get metaplex mint metadata account address */
export const getMetadata = async (
  mint: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey> => {
  return (
    await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("metadata"), METAPLEX.toBuffer(), mint.toBuffer()],
      METAPLEX
    )
  )[0];
};

/** Check that array is not empty */
function notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined;
}

const processChunk = async (chunk: (Metadata | null)[]) => {
  try {
    const tx = new anchor.web3.Transaction();
    for (const element of chunk) {
      if (element) {
        console.log("Creating instruction for", element.data.name);

        const metadataKey = await getMetadata(
          new anchor.web3.PublicKey(element.mint)
        );
        const updatedRoyalty = royalty
          ? parseInt(royalty)
          : element.data.sellerFeeBasisPoints;

        let inputCreators: Creator[] | null = null;
        if (newCreator) {
          // WARNING: this only successfully updates creators when there is either
          // no existing creators or one creator with 100% share.
          if (element.data.creators) {
            const modifiedCreatorSearch = element.data.creators.filter(
              (it) => it.share === 100
            );
            const modifiedCreator = modifiedCreatorSearch[0];
            if (!modifiedCreator) {
              console.log("Could not update creators for", element.data.name);
            }
            inputCreators = [
              {
                ...modifiedCreator,
                share: modifiedCreator.share - newCreator.share,
              },
              newCreator,
            ];
          } else {
            inputCreators = [newCreator];
          }
        }

        const data: UpdateMetadataAccountV2InstructionArgs = {
          updateMetadataAccountArgsV2: {
            data: {
              sellerFeeBasisPoints: updatedRoyalty,
              name: element.data.name,
              symbol: element.data.symbol,
              uri: element.data.uri,
              creators: inputCreators,
              collection: null,
              uses: null,
            },
            updateAuthority: null,
            primarySaleHappened: null,
            isMutable: null,
          },
        };

        const ix = createUpdateMetadataAccountV2Instruction(
          {
            metadata: metadataKey,
            updateAuthority: provider.wallet.publicKey,
          },
          data
        );
        tx.add(ix);
      }
    }
    const txId = await provider.sendAndConfirm(tx, [], {
      commitment: "confirmed",
    });
    console.log("txId", txId);
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
};

const runInstruction = async () => {
  const metadata = await Promise.all(
    mintAddresses.map((mint) => getMetadata(new anchor.web3.PublicKey(mint)))
  )
    .then((result) =>
      getMultipleAccounts(provider.connection, result, "processed")
    )
    .then((fetched) =>
      fetched.map((it) => it && Metadata.deserialize(it.account.data)[0])
    );

  const possibleImmutables = metadata.filter((it) => it && !it.isMutable);
  const immutables = possibleImmutables.filter(notEmpty);

  if (immutables.length > 0) {
    console.log(`Found ${immutables.length} immutable NFTs, will skip these`);
  }

  const filteredEntires = metadata
    .filter(notEmpty)
    .filter(
      (it) => !immutables.map((immutable) => immutable.mint).includes(it.mint)
    );

  const chunkedArray = chunks(filteredEntires, MAX_IX);
  console.log(`Found ${chunkedArray.length} chunks to process`);

  let count = 0;
  for (const chunk of chunkedArray) {
    console.log(
      `\nProcessing chunk ${count + 1} of ${chunkedArray.length} with ${
        chunk.length
      } items`
    );
    let result = false;
    while (result === false) {
      result = await processChunk(chunk);
      if (result === false) {
        console.log("Retrying");
        await sleep(SLEEP_TIME);
      } else {
        console.log("Success\n");
      }
    }
    count = count + 1;
    await sleep(1);
  }

  // check updated metadata
  const metadataKeys = await Promise.all(
    filteredEntires.map((it) => getMetadata(new anchor.web3.PublicKey(it.mint)))
  );
  const possibleUpdateMetadata = await getMultipleAccounts(
    provider.connection,
    metadataKeys,
    "processed"
  ).then((fetched) =>
    fetched.map((it) => it && Metadata.deserialize(it.account.data)[0])
  );
  const updateMetadata = possibleUpdateMetadata.filter(notEmpty);

  for (let index = 0; index < updateMetadata.length; index++) {
    const inputElement = filteredEntires[index];
    const metadataElement = updateMetadata[index];

    if (royalty) {
      assert(
        parseInt(royalty) === metadataElement.data.sellerFeeBasisPoints,
        `Found problem with ${inputElement.data.name}`
      );
    }
  }

  // Output skipped
  if (immutables.length > 0) {
    console.log("\nSkipped mints:");
    for (let index = 0; index < immutables.length; index++) {
      const element = immutables[index];
      if (element) {
        console.log(element.mint);
      }
    }
  }
};

runInstruction()
  .catch((error) => console.log(`Error ${error}`))
  .then(async () => {
    console.log("\nSolana network", RPC_URL);
  });
