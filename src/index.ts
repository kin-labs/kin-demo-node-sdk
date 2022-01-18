import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bs58 from 'bs58';

import {
  Client,
  Payment,
  Environment,
  kinToQuarks,
  PrivateKey,
  quarksToKin,
  TransactionType,
  PublicKey,
} from '@kinecosystem/kin-sdk-v2';

import {
  Event,
  EventsHandler,
  SignTransactionRequest,
  SignTransactionResponse,
  SignTransactionHandler,
} from '@kinecosystem/kin-sdk-v2/dist/webhook';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Set up Kin client
let kinClient = new Client(Environment.Test, { appIndex: 0 });
const appPrivateKey = PrivateKey.fromString(process.env.SECRET_KEY);
const appPublicKey = appPrivateKey?.publicKey()?.toBase58();

// List of Users
const users = {};
interface SaveKinAccount {
  name: string;
  privateKey: PrivateKey;
  kinTokenAccounts: PublicKey[];
}
function saveKinAccount({
  name,
  privateKey,
  kinTokenAccounts,
}: SaveKinAccount) {
  // TODO save your account data securely
  users[name] = { privateKey, kinTokenAccounts };
  console.log('🚀 ~ users', users);
}

// List of Transactions
const transactions = [];
interface SaveKinTransaction {
  transactionId: string;
}
function saveKinTransaction({ transactionId }: SaveKinTransaction) {
  // TODO save your transaction data if required
  transactions.push(transactionId);
  console.log('🚀 ~ transactions', transactions);
}

// Endpoints
app.get('/status', (req, res) => {
  console.log('🚀 ~ /status', kinClient?.appIndex || 'Not Instantiated');
  res.send(
    JSON.stringify({
      appIndex: kinClient ? kinClient.appIndex : 0,
      users: Object.keys(users),
      transactions,
    })
  );
});

interface AsyncRequest {
  req: Request;
  res: Response;
}
async function setUpServer({ req, res }: AsyncRequest) {
  const env = req.query.env === 'Prod' ? Environment.Prod : Environment.Test;
  const appIndex = Number(req.query.appIndex);
  kinClient = new Client(env, { appIndex });
  console.log('🚀 ~ kinClient', kinClient);

  res.sendStatus(201);
}

app.post('/setup', (req, res) => {
  console.log('🚀 ~ /setup');
  setUpServer({ req, res });
});

async function createKinAccount({ req, res }: AsyncRequest) {
  const name = req.query.name;
  console.log('🚀 ~ createKinAccount', name);
  try {
    if (typeof name === 'string') {
      const privateKey = PrivateKey.random();
      // Create Account - doesn't return anything
      await kinClient.createAccount(privateKey);

      // Resolve Token Account
      const kinTokenAccounts = await kinClient.resolveTokenAccounts(
        privateKey.publicKey()
      );

      saveKinAccount({ name, privateKey, kinTokenAccounts });
      res.sendStatus(201);
    } else {
      throw new Error('No valid name');
    }
  } catch (error) {
    console.log('🚀 ~ error', error);
    res.sendStatus(400);
  }
}

app.post('/account', (req, res) => {
  console.log('🚀 ~ /account');
  createKinAccount({ req, res });
});

async function getBalance({ req, res }: AsyncRequest) {
  const user = req?.query?.user || '';
  console.log('🚀 ~ getBalance ', user);
  try {
    if (typeof user === 'string') {
      let account;
      if (users[user]) {
        const { kinTokenAccounts } = users[user];
        account = kinTokenAccounts[0];
      } else {
        account = appPrivateKey.publicKey();
      }
      const balance = await kinClient.getBalance(account);
      console.log('🚀 ~ balance', balance);

      const balanceInKin = quarksToKin(balance);
      console.log('🚀 ~ balanceInKin', balanceInKin);

      res.send(balanceInKin);
    } else {
      throw new Error('No valid user');
    }
  } catch (error) {
    console.log('🚀 ~ error', error);
    res.sendStatus(400);
  }
}

app.get('/balance', (req, res) => {
  console.log('🚀 ~ /balance ');
  getBalance({ req, res });
});

async function requestAirdrop({ req, res }: AsyncRequest) {
  const to = req?.query?.to || '';
  const amount = req?.query?.amount || '0';
  console.log('🚀 ~ requestAirdrop', to, amount);
  if (typeof to === 'string' && typeof amount === 'string') {
    try {
      let destination;
      if (users[to]) {
        const { kinTokenAccounts } = users[to];
        destination = kinTokenAccounts[0];
      } else {
        destination = appPrivateKey.publicKey();
      }

      const quarks = kinToQuarks(amount);

      const buffer = await kinClient.requestAirdrop(destination, quarks);
      const transactionId = bs58.encode(buffer);
      saveKinTransaction({ transactionId });

      console.log('🚀 ~ airdrop successful', to, amount);
      res.sendStatus(200);
    } catch (error) {
      console.log('🚀 ~ error', error);
      res.sendStatus(400);
    }
  }
}

app.post('/airdrop', (req, res) => {
  console.log('🚀 ~ /airdrop ');
  requestAirdrop({ req, res });
});

async function getTransaction({ req, res }: AsyncRequest) {
  const transaction = req?.query?.transaction || '';
  console.log('🚀 ~ getTransaction', transaction);
  if (typeof transaction === 'string') {
    try {
      const transactionBuffer = bs58.decode(transaction);
      const { txId, txState, payments } = await kinClient.getTransaction(
        transactionBuffer
      );

      if (txState === 0) throw new Error("Can't find transaction");

      console.log('🚀 ~ Got Transaction!');
      console.log('🚀 ~ txId', bs58.encode(txId));

      let decodedPayments;
      if (payments?.length > 0) {
        decodedPayments = payments.map(
          ({ sender, destination, quarks, type }) => {
            const paymentObject = {
              type,
              quarks,
              sender: sender.toBase58(),
              destination: destination.toBase58(),
            };

            return paymentObject;
          }
        );
        console.log('🚀 ~ decodedPayments', decodedPayments);
      }

      res.send(JSON.stringify({ txState, payments: decodedPayments || [] }));
    } catch (error) {
      console.log('🚀 ~ error', error);
      res.sendStatus(400);
    }
  }
}

app.get('/transaction', (req, res) => {
  console.log('🚀 ~ /transaction ');
  getTransaction({ req, res });
});

function getTypeEnum(type) {
  let transactionType: TransactionType = TransactionType.None;
  if (type === 'P2P') {
    transactionType = TransactionType.P2P;
  }
  if (type === 'Spend') {
    transactionType = TransactionType.Spend;
  }
  if (type === 'Earn') {
    transactionType = TransactionType.Earn;
  }

  return transactionType;
}

async function submitPayment({ req, res }: AsyncRequest) {
  const { from, to, amount, type } = req.body;
  console.log('🚀 ~ submitPayment', from, to, amount, type);

  if (typeof from === 'string' && typeof to === 'string') {
    try {
      let sender;
      if (users[from]) {
        const { privateKey } = users[from];
        sender = privateKey;
      } else {
        sender = appPrivateKey;
      }

      let destination;
      if (users[to]) {
        const { kinTokenAccounts } = users[to];
        destination = kinTokenAccounts[0];
      } else {
        destination = appPrivateKey.publicKey();
      }

      const quarks = kinToQuarks(amount);
      const typeEnum = getTypeEnum(type);

      const paymentObject: Payment = {
        sender,
        destination,
        quarks,
        type: typeEnum,
      };

      const buffer = await kinClient.submitPayment(paymentObject);
      const transactionId = bs58.encode(buffer);
      saveKinTransaction({ transactionId });

      console.log('🚀 ~ payment successful', from, to, amount, type);
      res.sendStatus(200);
    } catch (error) {
      console.log('🚀 ~ error', error);
      res.sendStatus(400);
    }
  }
}

app.post('/send', (req, res) => {
  console.log('🚀 ~ /send ');
  submitPayment({ req, res });
});

// Webhooks
app.use(
  '/events',
  EventsHandler((events: Event[]) => {
    console.log('🚀 ~ /events', events);

    // TODO use these events to trigger actions in your App if required
  }, process.env.SERVER_WEBHOOK_SECRET)
);

app.use(
  '/sign_transaction',
  SignTransactionHandler(
    Environment.Test,
    (req: SignTransactionRequest, resp: SignTransactionResponse) => {
      console.log('🚀 ~ /sign_transaction', req);

      function checkIsValid() {
        // TODO
        // Implement transaction approval here!
        // This webhook will approve all incoming transactions
        return true;
      }

      const isValid = checkIsValid();
      console.log('🚀 ~ isValid', isValid);

      if (isValid) {
        resp.sign(appPrivateKey);
      } else {
        resp.reject();
      }
    },
    process.env.SERVER_WEBHOOK_SECRET
  )
);

// catch 404 and forward to error handler
app.use(function (req, res) {
  res.sendStatus(404);
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(
    `Kin App (Public Key - ${appPublicKey}) listening at http://localhost:${port}`
  );
});
