import asyncio
import aiohttp
import subprocess
import os
import sys

# Configuration
FABER_ADMIN = "http://localhost:8032"
ALICE_ADMIN = "http://localhost:8033"
GENESIS_URL = "http://localhost:9000/genesis"

async def wait_for_agent(admin_url, name):
    """Wait for an agent's admin API to become responsive."""
    async with aiohttp.ClientSession() as session:
        for i in range(30):
            try:
                async with session.get(f"{admin_url}/status/ready") as resp:
                    if resp.status == 200:
                        print(f"Agent {name} is ready.")
                        return True
            except Exception:
                pass
            await asyncio.sleep(1)
    print(f"Agent {name} failed to start.")
    return False

async def main():
    print("--- Starting Faber and Alice Agents ---")
    
    # Start Faber (Issuer)
    faber_log = open("faber.log", "w")
    faber_proc = subprocess.Popen([
        sys.executable, "-m", "acapy_agent", "start",
        "--label", "Faber.Agent",
        "--inbound-transport", "http", "0.0.0.0", "8022",
        "--outbound-transport", "http",
        "--endpoint", "http://localhost:8022",
        "--admin", "0.0.0.0", "8032",
        "--admin-insecure-mode",
        "--wallet-type", "askar",
        "--wallet-name", "FaberWallet",
        "--wallet-key", "faber_key",
        "--seed", "faber_seed_000000000000000000001",
        "--genesis-url", GENESIS_URL,
        "--auto-provision",
        "--recreate-wallet",
        "--auto-accept-invites",
        "--auto-accept-requests",
        "--auto-respond-credential-request",
        "--auto-respond-presentation-request",
        "--log-level", "info"
    ], stdout=faber_log, stderr=faber_log)

    # Start Alice (Holder)
    alice_log = open("alice.log", "w")
    alice_proc = subprocess.Popen([
        sys.executable, "-m", "acapy_agent", "start",
        "--label", "Alice.Agent",
        "--inbound-transport", "http", "0.0.0.0", "8023",
        "--outbound-transport", "http",
        "--endpoint", "http://localhost:8023",
        "--admin", "0.0.0.0", "8033",
        "--admin-insecure-mode",
        "--wallet-type", "askar",
        "--wallet-name", "AliceWallet",
        "--wallet-key", "alice_key",
        "--no-ledger",
        "--auto-provision",
        "--recreate-wallet",
        "--auto-accept-invites",
        "--auto-accept-requests",
        "--auto-respond-credential-offer",
        "--auto-respond-credential-request",
        "--auto-respond-presentation-request",
        "--log-level", "info"
    ], stdout=alice_log, stderr=alice_log)


    try:
        if not await wait_for_agent(FABER_ADMIN, "Faber") or not await wait_for_agent(ALICE_ADMIN, "Alice"):
            return

        async with aiohttp.ClientSession() as session:
            # 1. Establish Connection
            print("\n--- 1. Establishing Connection ---")
            async with session.post(f"{FABER_ADMIN}/out-of-band/create-invitation", json={"handshake_protocols": ["https://didcomm.org/didexchange/1.0"]}) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    print(f"Error creating invitation: {resp.status} - {text}")
                    raise Exception("Faber failed to create invitation")
                invitation = await resp.json()
            
            async with session.post(f"{ALICE_ADMIN}/out-of-band/receive-invitation", json=invitation["invitation"]) as resp:
                alice_conn = await resp.json()
                alice_conn_id = alice_conn["connection_id"]

            print(f"Connection initiated. Waiting for activation...")
            
            faber_conn_id = None
            for _ in range(10):
                await asyncio.sleep(2)
                async with session.get(f"{FABER_ADMIN}/connections") as resp:
                    conns = await resp.json()
                    results = conns.get("results", [])
                    active = [c for c in results if c["state"] == "active"]
                    if active:
                        faber_conn_id = active[0]["connection_id"]
                        break
                    else:
                        states = [c["state"] for c in results]
                        print(f"Waiting... Current connection states: {states}")
            
            if not faber_conn_id:
                raise Exception("Timed out waiting for connection to become active")
                
            print(f"Connection Active: Faber({faber_conn_id}) <-> Alice({alice_conn_id})")

            # 2. Create Schema and Cred Def (Faber writes to Ledger)
            print("\n--- 2. Creating Schema and Cred Def ---")
            schema_body = {
                "schema_name": "degree schema",
                "schema_version": "1.0",
                "attributes": ["name", "date", "degree"]
            }
            async with session.post(f"{FABER_ADMIN}/schemas", json=schema_body) as resp:
                schema = await resp.json()
                schema_id = schema["schema_id"]

            await asyncio.sleep(2) # Wait for ledger propagation

            cred_def_body = {"schema_id": schema_id}
            async with session.post(f"{FABER_ADMIN}/credential-definitions", json=cred_def_body) as resp:
                cred_def = await resp.json()
                cred_def_id = cred_def["credential_definition_id"]
            
            print(f"Schema ID: {schema_id}")
            print(f"Cred Def ID: {cred_def_id}")

            # 3. Issue Credential
            print("\n--- 3. Issuing Credential ---")
            issue_body = {
                "connection_id": faber_conn_id,
                "comment": "Issuing degree to Alice",
                "credential_preview": {
                    "@type": "issue-credential/2.0/credential-preview",
                    "attributes": [
                        {"name": "name", "value": "Alice Smith"},
                        {"name": "date", "value": "2026-05-05"},
                        {"name": "degree", "value": "Computer Science"}
                    ]
                },
                "filter": {"indy": {"cred_def_id": cred_def_id}},
                "auto_remove": False,
                "trace": True
            }
            async with session.post(f"{FABER_ADMIN}/issue-credential-2.0/send", json=issue_body) as resp:
                exch = await resp.json()
                print("Credential offer sent and issued.")

            await asyncio.sleep(5) # Wait for issuance to complete

            # 4. Request Proof (Verification)
            print("\n--- 4. Requesting Proof ---")
            proof_request = {
                "connection_id": faber_conn_id,
                "presentation_request": {
                    "indy": {
                        "name": "Proof of Degree",
                        "version": "1.0",
                        "requested_attributes": {
                            "attr1_referent": {
                                "name": "degree",
                                "restrictions": [{"cred_def_id": cred_def_id}]
                            }
                        },
                        "requested_predicates": {}
                    }
                }
            }
            async with session.post(f"{FABER_ADMIN}/present-proof-2.0/send-request", json=proof_request) as resp:
                pres_exch = await resp.json()
                print("Proof request sent.")

            await asyncio.sleep(5)
            print("\n--- Simulation Complete ---")
            print("Observer should have logged: Connection, Schema, Cred Def, Issuance, and Proof events.")

    except Exception as e:
        print(f"Error during simulation: {e}")
        import traceback
        traceback.print_exc()
        # Show logs if they exist
        for log_file in ["faber.log", "alice.log"]:
            if os.path.exists(log_file):
                print(f"\n--- Last 10 lines of {log_file} ---")
                with open(log_file, "r") as f:
                    print("".join(f.readlines()[-10:]))
    finally:
        print("\n--- Shutting down Agents ---")
        faber_proc.terminate()
        alice_proc.terminate()
        faber_log.close()
        alice_log.close()

if __name__ == "__main__":
    asyncio.run(main())
