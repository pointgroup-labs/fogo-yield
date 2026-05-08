/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/fogo_onre_relayer.json`.
 */
export type FogoOnreRelayer = {
  "address": "onrenRKgX54qtWeK3cuaTBE71xx7dWMXn82ubH61vAp",
  "metadata": {
    "name": "fogoOnreRelayer",
    "version": "0.1.2",
    "spec": "0.1.0",
    "description": "Fogo OnRe relayer — stateless PDA-custody bridge between OnRe and Wormhole NTT on Solana",
    "repository": "https://github.com/pointgroup-labs/fogo-onre"
  },
  "docs": [
    "Cross-chain relayer: USDC.s on FOGO ↔ ONyc on Solana, both legs over",
    "Wormhole NTT. Lets FOGO users hold OnRe's ONyc yield exposure without",
    "leaving FOGO."
  ],
  "instructions": [
    {
      "name": "acceptAuthority",
      "docs": [
        "Two-step rotation, step 2. Signer must equal `pending_authority`;",
        "current authority does not sign (lets independent multisigs rotate",
        "without atomic co-sign)."
      ],
      "discriminator": [
        107,
        86,
        198,
        91,
        33,
        12,
        107,
        160
      ],
      "accounts": [
        {
          "name": "pendingAuthority",
          "signer": true
        },
        {
          "name": "relayerConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "cancelRedemptionOnyc",
      "docs": [
        "Authority-only escape hatch — rolls a stuck redemption back to",
        "`Claimed` and frees the singleton. Authority-gated to prevent a",
        "request→cancel fee-griefing loop."
      ],
      "discriminator": [
        173,
        168,
        252,
        110,
        16,
        149,
        112,
        62
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "relayerConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "relayerAuthority",
          "docs": [
            "`redemption_request`, so unlocked ONyc returns to its `onyc_ata`."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "onycMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "onycAta",
          "docs": [
            "Receives unlocked ONyc from OnRe's redemption vault."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "onycMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "nttInboxItem"
        },
        {
          "name": "outflightFlow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  102,
                  108,
                  105,
                  103,
                  104,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "nttInboxItem"
              }
            ]
          }
        },
        {
          "name": "redemptionTracker",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "payerForClose",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "claimRedemptionUsdc",
      "discriminator": [
        171,
        90,
        50,
        244,
        156,
        19,
        211,
        106
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Receives rent from closed `redemption_tracker`. Need not equal",
            "`tracker.payer` — close-target is `payer_for_close` below."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "relayerConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "relayerAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "usdcAta",
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "nttInboxItem"
        },
        {
          "name": "outflightFlow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  102,
                  108,
                  105,
                  103,
                  104,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "nttInboxItem"
              }
            ]
          }
        },
        {
          "name": "redemptionTracker",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "payerForClose",
          "writable": true
        },
        {
          "name": "redemptionRequest",
          "docs": [
            "it has been closed by OnRe."
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "claimUsdc",
      "docs": [
        "Redeem inbound USDC.s VAA, create inbound `Flow` receipt."
      ],
      "discriminator": [
        43,
        131,
        9,
        102,
        229,
        140,
        91,
        141
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "relayerConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "relayerAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "usdcAta",
          "docs": [
            "Sweep destination — long-lived relayer-authority USDC ATA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userWallet",
          "docs": [
            "Originating FOGO wallet (Solana keys are chain-agnostic).",
            "Pinned via `user_inbox_authority` PDA derivation + NTT release",
            "ATA-authority check. See handler doc."
          ]
        },
        {
          "name": "userInboxAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  105,
                  110,
                  98,
                  111,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "userWallet"
              }
            ]
          }
        },
        {
          "name": "userInboxAta",
          "docs": [
            "NTT release_inbound deposits here; sweep moves exactly",
            "`flow.amount` to `usdc_ata`. Not `init_if_needed`: FOGO",
            "`bridge_ntt_tokens` arg `pay_destination_ata_rent: true` makes",
            "the executor create the ATA on first delivery."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "userInboxAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "nttInboxItem",
          "docs": [
            "No `#[account(owner = ...)]` here: on a fresh claim NTT redeem",
            "creates this account, so a pre-handler owner constraint would",
            "fail every first-time claim. The owner check runs in",
            "`validate_skip_path_inbox_item` — the only path where forgery is",
            "possible (no NTT CPI runs)."
          ]
        },
        {
          "name": "nttTransceiverMessage"
        },
        {
          "name": "inflightFlow",
          "docs": [
            "`init` blocks double-claims against the same inbox item."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  102,
                  108,
                  105,
                  103,
                  104,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "nttInboxItem"
              }
            ]
          }
        },
        {
          "name": "redemptionTracker",
          "docs": [
            "Withdraw-chain mutex gate. `SystemAccount` asserts no",
            "`RedemptionTracker` exists — pauses deposit inflows so they",
            "can't pollute `claim_redemption_usdc`'s delta math."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "redeemAccountsLen",
          "type": "u8"
        }
      ]
    },
    {
      "name": "configure",
      "docs": [
        "Authority-only. `None` args leave fields unchanged. Fee decreases",
        "apply instantly; increases stage for `FEE_TIMELOCK_SLOTS` (~2 days)",
        "then auto-promote on the next `configure` after the window."
      ],
      "discriminator": [
        245,
        7,
        108,
        117,
        95,
        196,
        54,
        217
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "relayerConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "relayerAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "onycMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "onycAta",
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "onycMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "feeVault",
          "docs": [
            "`None` leaves the stored vault unchanged."
          ],
          "optional": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "depositFeeBps",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "withdrawFeeBps",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "newAuthority",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "One-time setup: config PDA + relayer-authority-owned ATAs."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "relayerConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "relayerAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "onycMint"
        },
        {
          "name": "usdcAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "onycAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "onycMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "feeVault",
          "docs": [
            "Forbid `fee_vault == onyc_ata` to prevent self-transfer no-ops",
            "that would commingle user funds with fees."
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "depositFeeBps",
          "type": "u16"
        },
        {
          "name": "withdrawFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "lockOnyc",
      "docs": [
        "Lock ONyc via NTT and atomically emit the outbound VAA.",
        "`transfer_lock_account_count` splits `remaining_accounts` between",
        "`transfer_lock` and `release_wormhole_outbound`."
      ],
      "discriminator": [
        4,
        104,
        99,
        210,
        97,
        143,
        190,
        63
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "relayerConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "relayerAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "onycMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "onycAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "onycMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "nttInboxItem"
        },
        {
          "name": "inflightFlow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  102,
                  108,
                  105,
                  103,
                  104,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "nttInboxItem"
              }
            ]
          }
        },
        {
          "name": "rentDestination",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "transferLockAccountCount",
          "type": "u8"
        }
      ]
    },
    {
      "name": "requestRedemptionOnyc",
      "docs": [
        "Forward flow's ONyc to OnRe + init singleton tracker; fee taken pre-CPI."
      ],
      "discriminator": [
        117,
        2,
        5,
        175,
        6,
        12,
        151,
        176
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "relayerConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "relayerAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "onycMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "usdcAta",
          "docs": [
            "Pre-balance snapshot for `claim_redemption_usdc` delta."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "onycAta",
          "docs": [
            "Source for fee transfer; OnRe's CPI also pulls from here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "onycMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "feeVault",
          "writable": true,
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "nttInboxItem"
        },
        {
          "name": "outflightFlow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  102,
                  108,
                  105,
                  103,
                  104,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "nttInboxItem"
              }
            ]
          }
        },
        {
          "name": "redemptionTracker",
          "docs": [
            "Singleton init — fails if a prior redemption is mid-flight.",
            "On-chain mutex that makes the ATA-delta math safe."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "sendUsdcToUser",
      "discriminator": [
        34,
        19,
        226,
        203,
        16,
        87,
        167,
        249
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "relayerConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "relayerAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "usdcAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "nttInboxItem"
        },
        {
          "name": "outflightFlow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  102,
                  108,
                  105,
                  103,
                  104,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "nttInboxItem"
              }
            ]
          }
        },
        {
          "name": "rentDestination",
          "writable": true
        },
        {
          "name": "redemptionTracker",
          "docs": [
            "Singleton mutex gate — a concurrent outflow during an in-flight",
            "redemption would poison the pre-balance delta. Stuck redemptions",
            "are recovered via `cancel_redemption_onyc`."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "swapUsdcToOnyc",
      "discriminator": [
        88,
        26,
        182,
        123,
        92,
        54,
        57,
        55
      ],
      "accounts": [
        {
          "name": "relayerConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "relayerAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "onycMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "usdcAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "onycAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "onycMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "feeVault",
          "writable": true,
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "redemptionTracker",
          "docs": [
            "Withdraw-chain mutex gate (see `claim_usdc`)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  109,
                  112,
                  116,
                  105,
                  111,
                  110,
                  95,
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "nttInboxItem"
        },
        {
          "name": "inflightFlow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  102,
                  108,
                  105,
                  103,
                  104,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "nttInboxItem"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "unlockOnyc",
      "docs": [
        "Release ONyc from NTT custody, create outbound `Flow` receipt."
      ],
      "discriminator": [
        225,
        208,
        126,
        107,
        209,
        43,
        111,
        166
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "relayerConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "relayerAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "onycMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "onycAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "relayerAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "onycMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "nttInboxItem"
        },
        {
          "name": "nttTransceiverMessage"
        },
        {
          "name": "outflightFlow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  117,
                  116,
                  102,
                  108,
                  105,
                  103,
                  104,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "nttInboxItem"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "redeemAccountsLen",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "flow",
      "discriminator": [
        126,
        151,
        86,
        177,
        58,
        153,
        167,
        203
      ]
    },
    {
      "name": "redemptionTracker",
      "discriminator": [
        1,
        150,
        121,
        192,
        138,
        107,
        94,
        3
      ]
    },
    {
      "name": "relayerConfig",
      "discriminator": [
        116,
        239,
        42,
        132,
        218,
        154,
        194,
        20
      ]
    }
  ],
  "events": [
    {
      "name": "onycLocked",
      "discriminator": [
        204,
        229,
        7,
        145,
        121,
        187,
        201,
        215
      ]
    },
    {
      "name": "onycSwapped",
      "discriminator": [
        220,
        205,
        135,
        206,
        94,
        131,
        34,
        57
      ]
    },
    {
      "name": "onycUnlocked",
      "discriminator": [
        66,
        7,
        6,
        253,
        214,
        174,
        42,
        160
      ]
    },
    {
      "name": "redemptionCancelled",
      "discriminator": [
        22,
        106,
        118,
        26,
        83,
        110,
        71,
        174
      ]
    },
    {
      "name": "redemptionClaimed",
      "discriminator": [
        107,
        251,
        199,
        213,
        59,
        173,
        53,
        189
      ]
    },
    {
      "name": "redemptionRequested",
      "discriminator": [
        245,
        155,
        98,
        131,
        210,
        25,
        137,
        146
      ]
    },
    {
      "name": "usdcClaimed",
      "discriminator": [
        213,
        24,
        255,
        203,
        163,
        162,
        154,
        137
      ]
    },
    {
      "name": "usdcSentToUser",
      "discriminator": [
        175,
        37,
        177,
        185,
        231,
        238,
        242,
        73
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidAccountSplit",
      "msg": "remaining_accounts split point is out of range"
    },
    {
      "code": 6001,
      "name": "authorityNotInAccounts",
      "msg": "Relayer authority PDA not present in forwarded CPI accounts"
    },
    {
      "code": 6002,
      "name": "zeroFogoSender",
      "msg": "Parsed fogo_sender is the zero address"
    },
    {
      "code": 6003,
      "name": "unauthorizedAuthority",
      "msg": "Caller is not the authority"
    },
    {
      "code": 6004,
      "name": "flowStatusMismatch",
      "msg": "Flow is not in the expected status for this operation"
    },
    {
      "code": 6005,
      "name": "balanceUnderflow",
      "msg": "Post-CPI balance is less than pre-CPI balance"
    },
    {
      "code": 6006,
      "name": "zeroAmountFlow",
      "msg": "Bridge or swap produced zero tokens"
    },
    {
      "code": 6007,
      "name": "feeBpsTooHigh",
      "msg": "Fee basis points exceed MAX_FEE_BPS"
    },
    {
      "code": 6008,
      "name": "feeOverflow",
      "msg": "Fee computation overflow"
    },
    {
      "code": 6009,
      "name": "missingSessionAuthority",
      "msg": "NTT session authority PDA not found in remaining_accounts"
    },
    {
      "code": 6010,
      "name": "invalidTransceiverMessage",
      "msg": "NTT ValidatedTransceiverMessage account is malformed or too short"
    },
    {
      "code": 6011,
      "name": "transceiverMessageMismatch",
      "msg": "ntt_transceiver_message does not match the account consumed by the NTT redeem CPI"
    },
    {
      "code": 6012,
      "name": "inboxItemMismatch",
      "msg": "ntt_inbox_item does not match the account consumed by the NTT CPIs"
    },
    {
      "code": 6013,
      "name": "recipientAtaMismatch",
      "msg": "Destination token account does not match the ATA consumed by the NTT release CPI"
    },
    {
      "code": 6014,
      "name": "feeVaultAliasesUserAta",
      "msg": "fee_vault must not alias the relayer's ONyc operating ATA"
    },
    {
      "code": 6015,
      "name": "noPendingAuthority",
      "msg": "No pending authority — nothing to accept"
    },
    {
      "code": 6016,
      "name": "pendingAuthorityMismatch",
      "msg": "Signer does not match relayer_config.pending_authority"
    },
    {
      "code": 6017,
      "name": "redemptionNotFulfilled",
      "msg": "OnRe RedemptionRequest PDA still exists — redemption_admin has not fulfilled yet"
    },
    {
      "code": 6018,
      "name": "redemptionRequestMismatch",
      "msg": "Provided redemption_request account does not match tracker.redemption_request"
    },
    {
      "code": 6019,
      "name": "redemptionTrackerFlowMismatch",
      "msg": "RedemptionTracker.flow does not match the bound Flow PDA"
    },
    {
      "code": 6020,
      "name": "emptyPendingFee",
      "msg": "PendingFee bundle has no inner leg set — invariant violation"
    },
    {
      "code": 6021,
      "name": "wrongOriginChain",
      "msg": "Inbound NTT message did not originate from the FOGO peer chain"
    },
    {
      "code": 6022,
      "name": "unexpectedOnycConsumed",
      "msg": "Post-CPI ONyc balance dropped — OnRe consumed ONyc unexpectedly"
    },
    {
      "code": 6023,
      "name": "userInboxAuthorityMismatch",
      "msg": "user_inbox_ata's authority does not match the [user_inbox, user_wallet] PDA"
    },
    {
      "code": 6024,
      "name": "unexpectedFogoSender",
      "msg": "NTT VAA's NttManagerMessage.sender is not the intent_transfer setter PDA — deposit must originate via intent_transfer"
    },
    {
      "code": 6025,
      "name": "invalidInboxItem",
      "msg": "ntt_inbox_item account is missing, too short, or has the wrong discriminator"
    },
    {
      "code": 6026,
      "name": "insufficientInboxBalance",
      "msg": "user_inbox_ata balance is below the NTT-recorded inbox_item.amount — inbox was not credited as expected"
    },
    {
      "code": 6027,
      "name": "pendingAuthorityIsCurrent",
      "msg": "Proposed pending_authority equals the current authority — self-rotate is rejected"
    }
  ],
  "types": [
    {
      "name": "flow",
      "docs": [
        "One-shot receipt binding an inbound bridge message to a FOGO wallet.",
        "Replay protection lives in the per-VAA NTT claim account. Field set",
        "is byte-stable — older PDAs must keep deserializing."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fogoSender",
            "docs": [
              "Originator on FOGO; outbound recipient on the return leg."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "flowStatus"
              }
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "flowStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "claimed"
          },
          {
            "name": "swapped"
          },
          {
            "name": "redemptionPending"
          }
        ]
      }
    },
    {
      "name": "onycLocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "flow",
            "type": "pubkey"
          },
          {
            "name": "nttInboxItem",
            "type": "pubkey"
          },
          {
            "name": "fogoSender",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "onycSwapped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "flow",
            "type": "pubkey"
          },
          {
            "name": "grossAmount",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "netAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "onycUnlocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "flow",
            "type": "pubkey"
          },
          {
            "name": "nttInboxItem",
            "type": "pubkey"
          },
          {
            "name": "fogoSender",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pendingFee",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositFeeBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "withdrawFeeBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "readySlot",
            "docs": [
              "MAX-extended on later raises so a follow-up never shortens the window."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "redemptionCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "flow",
            "type": "pubkey"
          },
          {
            "name": "redemptionRequest",
            "type": "pubkey"
          },
          {
            "name": "returnedOnycAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "redemptionClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "flow",
            "type": "pubkey"
          },
          {
            "name": "redemptionRequest",
            "type": "pubkey"
          },
          {
            "name": "onycAmountIn",
            "type": "u64"
          },
          {
            "name": "usdcReceived",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "redemptionRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "flow",
            "type": "pubkey"
          },
          {
            "name": "redemptionRequest",
            "type": "pubkey"
          },
          {
            "name": "grossAmount",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "netAmount",
            "type": "u64"
          },
          {
            "name": "usdcAtaPreBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "redemptionTracker",
      "docs": [
        "Singleton mutex for the in-flight withdraw-chain redemption.",
        "`init` here fails if another redemption is mid-flight, blocking the",
        "USDC-delta race."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "flow",
            "type": "pubkey"
          },
          {
            "name": "redemptionRequest",
            "docs": [
              "OnRe `RedemptionRequest` PDA; polled for closure as fulfillment signal."
            ],
            "type": "pubkey"
          },
          {
            "name": "usdcAtaPreBalance",
            "docs": [
              "Relayer USDC ATA balance pre-CPI; `claim_redemption_usdc` uses",
              "post-fulfillment delta vs this."
            ],
            "type": "u64"
          },
          {
            "name": "onycAmountIn",
            "docs": [
              "Audit-trail only — net-of-fee ONyc sent to OnRe."
            ],
            "type": "u64"
          },
          {
            "name": "payer",
            "docs": [
              "Pays for init, receives rent on close."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "relayerConfig",
      "docs": [
        "`authority` gates governance only; flow instructions are permissionless."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "onycMint",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "feeVault",
            "type": "pubkey"
          },
          {
            "name": "depositFeeBps",
            "type": "u16"
          },
          {
            "name": "withdrawFeeBps",
            "type": "u16"
          },
          {
            "name": "relayerAuthorityBump",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "pendingAuthority",
            "docs": [
              "Promoted to `authority` by `accept_authority` (two-step handoff)."
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "pendingFee",
            "docs": [
              "Staged fee *increase*, auto-promoted on next `configure` once",
              "`ready_slot` elapses. Decreases bypass this."
            ],
            "type": {
              "option": {
                "defined": {
                  "name": "pendingFee"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "usdcClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "flow",
            "type": "pubkey"
          },
          {
            "name": "nttInboxItem",
            "type": "pubkey"
          },
          {
            "name": "fogoSender",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "usdcSentToUser",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "flow",
            "type": "pubkey"
          },
          {
            "name": "nttInboxItem",
            "type": "pubkey"
          },
          {
            "name": "fogoSender",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "intentTransferProgramId",
      "type": "pubkey",
      "value": "Xfry4dW9m42ncAqm8LyEnyS5V6xu5DSJTMRQLiGkARD"
    },
    {
      "name": "nttOnycProgramId",
      "type": "pubkey",
      "value": "nttpna5vXW7BN2Aa4AfTbkCncJWTEoBsnWvjS87Xgsd"
    },
    {
      "name": "nttUsdcProgramId",
      "type": "pubkey",
      "value": "nttu74CdAmsErx5daJVCQNoDZujswFrskMzonoZSdGk"
    },
    {
      "name": "onreProgramId",
      "type": "pubkey",
      "value": "onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe"
    },
    {
      "name": "wormholeCoreProgramId",
      "docs": [
        "Wormhole Core Bridge program id. Documentation pin only — release CPIs",
        "dispatch via `remaining_accounts`, no on-chain read site today."
      ],
      "type": "pubkey",
      "value": "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
    }
  ]
};
