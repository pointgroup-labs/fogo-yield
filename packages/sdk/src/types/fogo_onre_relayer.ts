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
    "version": "0.1.4",
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
      "name": "configure",
      "docs": [
        "Authority-only. `None` args leave fields unchanged. Fee decreases",
        "apply instantly; increases stage for `FEE_TIMELOCK_SLOTS` (~2 days)",
        "then auto-promote on the next `configure` after the window.",
        "`slippage_bps` (capped at `MAX_SLIPPAGE_BPS` via `validate`) applies",
        "immediately to both swap legs' NAV floor."
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
          "name": "assetMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "assetAta",
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
                "path": "assetMint"
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
        },
        {
          "name": "slippageBps",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "priceOracle",
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
          "name": "baseMint"
        },
        {
          "name": "assetMint"
        },
        {
          "name": "baseAta",
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
                "path": "baseMint"
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
          "name": "assetAta",
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
                "path": "assetMint"
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
      "name": "receive",
      "docs": [
        "Redeem an inbound NTT VAA (deposit: base/USDC, withdraw: asset/ONyc),",
        "create the `Flow` receipt. Direction selects the NTT manager + flow seed."
      ],
      "discriminator": [
        86,
        17,
        255,
        171,
        17,
        17,
        187,
        219
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
          "name": "recvMint",
          "docs": [
            "The received token's mint. Pinned in-handler to the direction-selected",
            "config mint (base for deposit, asset for withdraw)."
          ]
        },
        {
          "name": "recvAta",
          "docs": [
            "Sweep destination — long-lived relayer-authority ATA for recv_mint."
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
                "path": "recvMint"
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
          "name": "userWallet"
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
                "path": "recvMint"
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
          "name": "nttProgram"
        },
        {
          "name": "flow",
          "writable": true
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
          "name": "direction",
          "type": {
            "defined": {
              "name": "direction"
            }
          }
        },
        {
          "name": "redeemAccountsLen",
          "type": "u8"
        }
      ]
    },
    {
      "name": "send",
      "docs": [
        "Route-agnostic outbound send. Routes on `flow.direction`: deposit",
        "pushes asset (ONyc) out, withdraw pushes base (USDC) out, each via NTT",
        "`transfer_lock` + atomic `release_wormhole_outbound`. Replaces",
        "`lock_onyc` and `send_usdc_to_user`. `transfer_lock_account_count`",
        "splits `remaining_accounts` between the two NTT CPIs."
      ],
      "discriminator": [
        102,
        251,
        20,
        187,
        65,
        75,
        12,
        69
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
          "name": "baseMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "assetMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "baseAta",
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
                "path": "baseMint"
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
          "name": "assetAta",
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
                "path": "assetMint"
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
          "name": "flow",
          "writable": true
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
      "name": "swap",
      "docs": [
        "Permissionless, route-agnostic swap. Routes on `flow.direction`:",
        "deposit swaps base→asset (fee from the asset output), withdraw swaps",
        "asset→base (fee from the asset input). Replaces `swap_usdc_to_onyc`",
        "and `swap_onyc_to_usdc`."
      ],
      "discriminator": [
        248,
        198,
        158,
        145,
        225,
        117,
        135,
        200
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
          "docs": [
            "and swap CPI. Reach bounded by the post-CPI ATA assertions."
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
          "name": "baseMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "assetMint",
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "baseAta",
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
                "path": "baseMint"
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
          "name": "assetAta",
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
                "path": "assetMint"
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
            "Fee destination — always denominated in the asset (ONyc) token."
          ],
          "writable": true,
          "relations": [
            "relayerConfig"
          ]
        },
        {
          "name": "nttInboxItem"
        },
        {
          "name": "flow",
          "writable": true
        },
        {
          "name": "onreOffer",
          "docs": [
            "it as the OnRe Offer PDA via read_offer_nav_price."
          ]
        },
        {
          "name": "swapProgram",
          "docs": [
            "not program identity."
          ]
        },
        {
          "name": "swapDelegate",
          "docs": [
            "`relayer_authority` as a sentinel for owner-signed routers (OnRe)."
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "swapIxData",
          "type": "bytes"
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
      "name": "received",
      "discriminator": [
        64,
        93,
        61,
        227,
        221,
        171,
        20,
        177
      ]
    },
    {
      "name": "sent",
      "discriminator": [
        230,
        90,
        111,
        254,
        186,
        174,
        45,
        74
      ]
    },
    {
      "name": "swapped",
      "discriminator": [
        217,
        52,
        52,
        83,
        147,
        135,
        96,
        109
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
      "name": "emptyPendingFee",
      "msg": "PendingFee bundle has no inner leg set — invariant violation"
    },
    {
      "code": 6018,
      "name": "wrongOriginChain",
      "msg": "Inbound NTT message did not originate from the FOGO peer chain"
    },
    {
      "code": 6019,
      "name": "userInboxAuthorityMismatch",
      "msg": "user_inbox_ata's authority does not match the [user_inbox, user_wallet] PDA"
    },
    {
      "code": 6020,
      "name": "unexpectedFogoSender",
      "msg": "NTT VAA's NttManagerMessage.sender is not the intent_transfer setter PDA — deposit must originate via intent_transfer"
    },
    {
      "code": 6021,
      "name": "invalidInboxItem",
      "msg": "ntt_inbox_item account is missing, too short, or has the wrong discriminator"
    },
    {
      "code": 6022,
      "name": "insufficientInboxBalance",
      "msg": "user_inbox_ata balance is below the NTT-recorded inbox_item.amount — inbox was not credited as expected"
    },
    {
      "code": 6023,
      "name": "pendingAuthorityIsCurrent",
      "msg": "Proposed pending_authority equals the current authority — self-rotate is rejected"
    },
    {
      "code": 6024,
      "name": "onreNoActiveVector",
      "msg": "No active OnRe pricing vector for the current clock"
    },
    {
      "code": 6025,
      "name": "onreNavOverflow",
      "msg": "Overflow in OnRe NAV computation"
    },
    {
      "code": 6026,
      "name": "onreOfferTooShort",
      "msg": "OnRe Offer account data is shorter than the pinned layout"
    },
    {
      "code": 6027,
      "name": "onreOfferTokenInMintMismatch",
      "msg": "OnRe Offer token_in_mint does not match relayer_config.usdc_mint"
    },
    {
      "code": 6028,
      "name": "onreOfferTokenOutMintMismatch",
      "msg": "OnRe Offer token_out_mint does not match relayer_config.onyc_mint"
    },
    {
      "code": 6029,
      "name": "onreOfferOwnerMismatch",
      "msg": "onre_offer account owner is not the OnRe program — handler refuses to read a foreign account as a pricing oracle"
    },
    {
      "code": 6030,
      "name": "onreOfferAddressMismatch",
      "msg": "onre_offer address does not match the deposit Offer PDA derived from (usdc_mint, onyc_mint)"
    },
    {
      "code": 6031,
      "name": "onreInvalidSlippageBps",
      "msg": "MAX_SLIPPAGE_BPS is misconfigured (> 10_000) — refusing to compute a zero floor"
    },
    {
      "code": 6032,
      "name": "slippageBpsTooHigh",
      "msg": "Configured slippage_bps exceeds MAX_SLIPPAGE_BPS ceiling"
    },
    {
      "code": 6033,
      "name": "ataAuthorityTampered",
      "msg": "Relayer ATA authority/delegate/close_authority was mutated by the swap CPI"
    },
    {
      "code": 6034,
      "name": "badPriceOracle",
      "msg": "price_oracle account does not match relayer_config.price_oracle (or it is unset)"
    },
    {
      "code": 6035,
      "name": "inputConsumedMismatch",
      "msg": "swap consumed an input amount different from the flow amount"
    },
    {
      "code": 6036,
      "name": "outputBelowFloor",
      "msg": "swap output fell below the NAV-anchored slippage floor"
    },
    {
      "code": 6037,
      "name": "swapAccountNotAllowed",
      "msg": "a swap account aliases relayer custody (fee_vault/config/flow or a relayer_authority-owned token account)"
    },
    {
      "code": 6038,
      "name": "relayerAuthorityTampered",
      "msg": "swap CPI drained, reassigned, or reallocated the relayer_authority PDA"
    },
    {
      "code": 6039,
      "name": "badNttProgram",
      "msg": "ntt_program / transceiver owner does not match the direction-selected NTT manager"
    },
    {
      "code": 6040,
      "name": "badReceiveMint",
      "msg": "recv_mint does not match the direction-selected config mint"
    }
  ],
  "types": [
    {
      "name": "direction",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "deposit"
          },
          {
            "name": "withdraw"
          }
        ]
      }
    },
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
            "name": "recipient",
            "docs": [
              "Originator on FOGO; outbound recipient on the return leg. Both legs are",
              "SVM, so this is a pubkey; the NTT wire ABI takes its raw bytes."
            ],
            "type": "pubkey"
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
          },
          {
            "name": "direction",
            "docs": [
              "`Direction::Deposit` or `Direction::Withdraw`. Persisted at receive,",
              "read by `swap`/`send` to select fee side and NTT manager."
            ],
            "type": {
              "defined": {
                "name": "direction"
              }
            }
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
            "name": "received"
          },
          {
            "name": "swapped"
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
      "name": "received",
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
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "direction",
            "type": {
              "defined": {
                "name": "direction"
              }
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
      "name": "relayerConfig",
      "docs": [
        "`authority` gates governance only; flow instructions are permissionless.",
        "",
        "Layout discipline: all fixed-size fields (including `max_slippage_bps` and the",
        "`reserved` block) come before the two variable-length `Option`s, which stay",
        "last. Future additive fields are carved out of `reserved` — same total size,",
        "so they need no realloc and no migration (old zero bytes read as the new",
        "field's default)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "assetMint",
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
            "name": "maxSlippageBps",
            "docs": [
              "Authority-tunable NAV slippage tolerance applied on both swap legs.",
              "Hard-capped at `MAX_SLIPPAGE_BPS` by `validate`."
            ],
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
            "name": "priceOracle",
            "docs": [
              "Config-pinned OnRe `Offer` PDA — the swap value-floor oracle.",
              "Zeroed in legacy accounts ⇒ `Pubkey::default()` ⇒ fail-closed",
              "(`BadPriceOracle`) until `configure` sets it."
            ],
            "type": "pubkey"
          },
          {
            "name": "reserved",
            "docs": [
              "Headroom for future fixed-size fields without another migration."
            ],
            "type": {
              "array": [
                "u8",
                96
              ]
            }
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
      "name": "sent",
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
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "direction",
            "type": {
              "defined": {
                "name": "direction"
              }
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
      "name": "swapped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "flow",
            "type": "pubkey"
          },
          {
            "name": "direction",
            "type": {
              "defined": {
                "name": "direction"
              }
            }
          },
          {
            "name": "grossIn",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "netOut",
            "type": "u64"
          },
          {
            "name": "floor",
            "type": "u64"
          },
          {
            "name": "swapProgram",
            "type": "pubkey"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "intentTransferProgramId",
      "docs": [
        "SECURITY-CRITICAL CROSS-PROGRAM PIN (deposit flow trust chain):",
        "1. webapp signs an intent → recipient = per-user inbox PDA on Solana",
        "2. FOGO `intent_transfer.bridge_ntt_tokens` bridges via NTT;",
        "the from-ATA owner is the singleton `[INTENT_TRANSFER_SETTER_SEED]`",
        "PDA under `INTENT_TRANSFER_PROGRAM_ID`",
        "3. that PDA surfaces as `NttManagerMessage.sender` on the VAA",
        "4. `receive` requires `sender == intent_transfer setter PDA`,",
        "rejecting any direct (non-intent) NTT bridge to the same recipient",
        "",
        "If `intent_transfer` rotates its setter seed OR redeploys at a new program",
        "ID, this relayer must redeploy in lockstep. DO NOT make these",
        "runtime-rotatable via `RelayerConfig` — a stolen authority key could",
        "otherwise redirect the entire deposit flow."
      ],
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
      "name": "onreIntentProgramId",
      "docs": [
        "SECURITY-CRITICAL CROSS-PROGRAM PIN — second member of the permanent",
        "{OnRe, Fogo} setter allowlist. This is the OnRe fork of Fogo's",
        "`intent_transfer` (same source, `declare_id!` only). Compile-time",
        "constant by design: a runtime-rotatable pin would let a stolen",
        "authority redirect deposit/redeem flow (see the Fogo pin doc above)."
      ],
      "type": "pubkey",
      "value": "inTFf5S7ZtYr8SkwGG85mjDwAyJwjqEPdH2p2nuyrL9"
    },
    {
      "name": "onreProgramId",
      "type": "pubkey",
      "value": "onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe"
    }
  ]
};
