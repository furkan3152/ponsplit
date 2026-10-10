use super::*;
use solana_program::program_stubs::{set_syscall_stubs, SyscallStubs};
use std::sync::Once;

// Native Solana processor tests supply the runtime Rent sysvar; no market/API
// fixtures or claimed mainnet accounts are used.
struct RentSysvar;
impl SyscallStubs for RentSysvar {
    fn sol_get_rent_sysvar(&self, destination: *mut u8) -> u64 {
        unsafe {
            std::ptr::write(destination.cast::<Rent>(), Rent::default());
        }
        0
    }
}

struct Fixture {
    program: Pubkey,
    verifier: Pubkey,
    beneficiary: Pubkey,
    address: Pubkey,
    data: Vec<u8>,
    lamports: u64,
}

impl Fixture {
    fn new() -> Self {
        static INSTALL: Once = Once::new();
        INSTALL.call_once(|| {
            set_syscall_stubs(Box::new(RentSysvar));
        });
        let program = Pubkey::new_unique();
        let verifier = Pubkey::new_unique();
        let beneficiary = Pubkey::new_unique();
        let handle = b"real.creator";
        let (address, bump) =
            Pubkey::find_program_address(&[SEED, verifier.as_ref(), handle], &program);
        let mut data = vec![0; VAULT_LEN];
        data[..8].copy_from_slice(MAGIC);
        data[8] = bump;
        data[9] = handle.len() as u8;
        data[10..10 + handle.len()].copy_from_slice(handle);
        data[34..66].copy_from_slice(verifier.as_ref());
        Self {
            program,
            verifier,
            beneficiary,
            address,
            data,
            lamports: Rent::default().minimum_balance(VAULT_LEN) + 50_000,
        }
    }

    fn bind(
        &mut self,
        verifier: Pubkey,
        verifier_signer: bool,
        beneficiary: Pubkey,
        beneficiary_signer: bool,
        hash: [u8; 32],
    ) -> ProgramResult {
        let system = system_program::id();
        let mut verifier_lamports = 0;
        let mut beneficiary_lamports = 0;
        let mut verifier_data = [];
        let mut beneficiary_data = [];
        let accounts = [
            AccountInfo::new(
                &verifier,
                verifier_signer,
                false,
                &mut verifier_lamports,
                &mut verifier_data,
                &system,
                false,
                0,
            ),
            AccountInfo::new(
                &beneficiary,
                beneficiary_signer,
                false,
                &mut beneficiary_lamports,
                &mut beneficiary_data,
                &system,
                false,
                0,
            ),
            AccountInfo::new(
                &self.address,
                false,
                true,
                &mut self.lamports,
                &mut self.data,
                &self.program,
                false,
                0,
            ),
        ];
        let mut instruction = vec![1];
        instruction.extend_from_slice(&hash);
        process_instruction(&self.program, &accounts, &instruction)
    }

    fn verified(&mut self) {
        assert_eq!(
            self.bind(self.verifier, true, self.beneficiary, true, [7; 32]),
            Ok(())
        );
    }

    fn claim(&mut self, claimant: Pubkey, signer: bool, balance: &mut u64) -> ProgramResult {
        self.claim_with_owner(claimant, signer, balance, self.program)
    }

    fn claim_with_owner(
        &mut self,
        claimant: Pubkey,
        signer: bool,
        balance: &mut u64,
        owner: Pubkey,
    ) -> ProgramResult {
        let system = system_program::id();
        let mut claimant_data = [];
        let accounts = [
            AccountInfo::new(
                &claimant,
                signer,
                true,
                balance,
                &mut claimant_data,
                &system,
                false,
                0,
            ),
            AccountInfo::new(
                &self.address,
                false,
                true,
                &mut self.lamports,
                &mut self.data,
                &owner,
                false,
                0,
            ),
        ];
        process_instruction(&self.program, &accounts, &[2])
    }

    fn init_again(&mut self, verifier: Pubkey, signed: bool) -> ProgramResult {
        let payer = Pubkey::new_unique();
        let system = system_program::id();
        let native_loader = Pubkey::new_unique();
        let mut payer_lamports = 10_000_000;
        let mut payer_data = [];
        let mut system_lamports = 0;
        let mut system_data = [];
        let accounts = [
            AccountInfo::new(
                &payer,
                signed,
                true,
                &mut payer_lamports,
                &mut payer_data,
                &system,
                false,
                0,
            ),
            AccountInfo::new(
                &self.address,
                false,
                true,
                &mut self.lamports,
                &mut self.data,
                &self.program,
                false,
                0,
            ),
            AccountInfo::new(
                &system,
                false,
                false,
                &mut system_lamports,
                &mut system_data,
                &native_loader,
                true,
                0,
            ),
        ];
        let mut instruction = vec![0, 12];
        instruction.extend_from_slice(b"real.creator");
        instruction.extend_from_slice(verifier.as_ref());
        process_instruction(&self.program, &accounts, &instruction)
    }
}

#[test]
fn bind_requires_both_signatures_and_the_immutable_verifier() {
    let mut f = Fixture::new();
    let unchanged = f.data.clone();
    assert_eq!(
        f.bind(f.verifier, false, f.beneficiary, true, [7; 32]),
        Err(ProgramError::MissingRequiredSignature)
    );
    assert_eq!(
        f.bind(f.verifier, true, f.beneficiary, false, [7; 32]),
        Err(ProgramError::MissingRequiredSignature)
    );
    assert_eq!(
        f.bind(Pubkey::new_unique(), true, f.beneficiary, true, [7; 32]),
        Err(EscrowError::WrongVerifier.into())
    );
    assert_eq!(f.data, unchanged);
    f.verified();
    assert_eq!(&f.data[66..98], f.beneficiary.as_ref());
    assert_eq!(&f.data[98..130], &[7; 32]);
}

#[test]
fn beneficiary_and_identity_cannot_be_rebound_or_reset() {
    let mut f = Fixture::new();
    assert_eq!(
        f.bind(f.verifier, true, f.beneficiary, true, [0; 32]),
        Err(EscrowError::InvalidIdentity.into())
    );
    assert_eq!(
        f.bind(f.verifier, true, Pubkey::default(), true, [7; 32]),
        Err(EscrowError::InvalidIdentity.into())
    );
    assert_eq!(
        f.bind(f.verifier, true, f.verifier, true, [7; 32]),
        Err(EscrowError::InvalidIdentity.into())
    );
    f.verified();
    let original = f.data.clone();
    assert_eq!(
        f.bind(f.verifier, true, Pubkey::new_unique(), true, [8; 32]),
        Err(EscrowError::AlreadyBound.into())
    );
    assert_eq!(
        f.bind(f.verifier, true, f.beneficiary, true, [7; 32]),
        Err(EscrowError::AlreadyBound.into())
    );
    assert_eq!(f.data, original);
}

#[test]
fn initializing_a_genuine_vault_is_idempotent_and_cannot_replace_authority() {
    let mut f = Fixture::new();
    f.verified();
    let original = f.data.clone();
    let balance = f.lamports;
    assert_eq!(f.init_again(f.verifier, true), Ok(()));
    assert_eq!(
        f.init_again(Pubkey::new_unique(), true),
        Err(EscrowError::InvalidVault.into())
    );
    assert_eq!(
        f.init_again(f.verifier, false),
        Err(ProgramError::MissingRequiredSignature)
    );
    assert_eq!(f.data, original);
    assert_eq!(f.lamports, balance);
}

#[test]
fn unverified_vault_and_verifier_cannot_withdraw() {
    let mut f = Fixture::new();
    let mut balance = 123;
    let original_balance = f.lamports;
    assert_eq!(
        f.claim(f.beneficiary, true, &mut balance),
        Err(EscrowError::Unverified.into())
    );
    f.verified();
    assert_eq!(
        f.claim(f.verifier, true, &mut balance),
        Err(EscrowError::WrongBeneficiary.into())
    );
    assert_eq!(
        f.claim(Pubkey::new_unique(), true, &mut balance),
        Err(EscrowError::WrongBeneficiary.into())
    );
    assert_eq!(
        f.claim(f.beneficiary, false, &mut balance),
        Err(ProgramError::MissingRequiredSignature)
    );
    assert_eq!(balance, 123);
    assert_eq!(f.lamports, original_balance);
    assert_eq!(u64::from_le_bytes(f.data[130..138].try_into().unwrap()), 0);
}

#[test]
fn claim_transfers_only_above_rent_and_tracks_later_deposits() {
    let mut f = Fixture::new();
    f.verified();
    let rent = Rent::default().minimum_balance(VAULT_LEN);
    let mut balance = 123;
    assert_eq!(f.claim(f.beneficiary, true, &mut balance), Ok(()));
    assert_eq!(balance, 50_123);
    assert_eq!(f.lamports, rent);
    assert_eq!(
        u64::from_le_bytes(f.data[130..138].try_into().unwrap()),
        50_000
    );
    assert_eq!(f.claim(f.beneficiary, true, &mut balance), Ok(()));
    assert_eq!(balance, 50_123);
    f.lamports += 25_000;
    assert_eq!(f.claim(f.beneficiary, true, &mut balance), Ok(()));
    assert_eq!(balance, 75_123);
    assert_eq!(f.lamports, rent);
    assert_eq!(
        u64::from_le_bytes(f.data[130..138].try_into().unwrap()),
        75_000
    );
}

#[test]
fn overflow_leaves_all_balances_and_state_unchanged() {
    let mut f = Fixture::new();
    f.verified();
    f.data[130..138].copy_from_slice(&u64::MAX.to_le_bytes());
    let original = f.data.clone();
    let old_lamports = f.lamports;
    let mut balance = 123;
    assert_eq!(
        f.claim(f.beneficiary, true, &mut balance),
        Err(EscrowError::Overflow.into())
    );
    assert_eq!(f.data, original);
    assert_eq!(f.lamports, old_lamports);
    assert_eq!(balance, 123);
    f.data[130..138].fill(0);
    balance = u64::MAX;
    assert_eq!(
        f.claim(f.beneficiary, true, &mut balance),
        Err(EscrowError::Overflow.into())
    );
    assert_eq!(f.lamports, old_lamports);
    assert_eq!(balance, u64::MAX);
    assert_eq!(u64::from_le_bytes(f.data[130..138].try_into().unwrap()), 0);
}

#[test]
fn copied_foreign_noncanonical_or_corrupt_vaults_cannot_withdraw() {
    let mut f = Fixture::new();
    f.verified();
    let mut balance = 123;
    assert_eq!(
        f.claim_with_owner(f.beneficiary, true, &mut balance, system_program::id()),
        Err(EscrowError::InvalidVault.into())
    );
    let address = f.address;
    f.address = Pubkey::new_unique();
    assert_eq!(
        f.claim(f.beneficiary, true, &mut balance),
        Err(EscrowError::InvalidVault.into())
    );
    f.address = address;
    f.data[8] ^= 1;
    assert_eq!(
        f.claim(f.beneficiary, true, &mut balance),
        Err(EscrowError::InvalidVault.into())
    );
    f.data[8] ^= 1;
    f.data[33] = 1;
    assert_eq!(
        f.claim(f.beneficiary, true, &mut balance),
        Err(EscrowError::InvalidVault.into())
    );
    assert_eq!(balance, 123);
}

#[test]
fn malformed_instructions_are_rejected_without_account_access() {
    let program = Pubkey::new_unique();
    for data in [
        vec![],
        vec![255],
        vec![2, 0],
        vec![1],
        vec![1; 34],
        vec![0],
        vec![0, 0],
        vec![0, 25],
    ] {
        assert_eq!(
            process_instruction(&program, &[], &data),
            Err(ProgramError::InvalidInstructionData),
            "{data:?}"
        );
    }
    let mut upper = vec![0, 1, b'A'];
    upper.extend_from_slice(Pubkey::new_unique().as_ref());
    assert_eq!(
        process_instruction(&program, &[], &upper),
        Err(EscrowError::InvalidHandle.into())
    );
    assert!(!valid_handle(b"creator."));
    assert!(!valid_handle(b"@creator"));
    assert!(valid_handle(b"creator.name_1"));
}

#[test]
fn readonly_accounts_cannot_bind_or_move_money() {
    let mut f = Fixture::new();
    let system = system_program::id();
    let mut verifier_lamports = 0;
    let mut beneficiary_lamports = 123;
    let mut verifier_data = [];
    let mut beneficiary_data = [];
    {
        let accounts = [
            AccountInfo::new(
                &f.verifier,
                true,
                false,
                &mut verifier_lamports,
                &mut verifier_data,
                &system,
                false,
                0,
            ),
            AccountInfo::new(
                &f.beneficiary,
                true,
                false,
                &mut beneficiary_lamports,
                &mut beneficiary_data,
                &system,
                false,
                0,
            ),
            AccountInfo::new(
                &f.address,
                false,
                false,
                &mut f.lamports,
                &mut f.data,
                &f.program,
                false,
                0,
            ),
        ];
        let mut bind = vec![1];
        bind.extend_from_slice(&[7; 32]);
        assert_eq!(
            process_instruction(&f.program, &accounts, &bind),
            Err(ProgramError::InvalidAccountData)
        );
    }
    f.verified();
    let old_lamports = f.lamports;
    {
        let mut accounts = [
            AccountInfo::new(
                &f.beneficiary,
                true,
                false,
                &mut beneficiary_lamports,
                &mut beneficiary_data,
                &system,
                false,
                0,
            ),
            AccountInfo::new(
                &f.address,
                false,
                true,
                &mut f.lamports,
                &mut f.data,
                &f.program,
                false,
                0,
            ),
        ];
        assert_eq!(
            process_instruction(&f.program, &accounts, &[2]),
            Err(ProgramError::InvalidAccountData)
        );
        accounts[0].is_writable = true;
        accounts[1].is_writable = false;
        assert_eq!(
            process_instruction(&f.program, &accounts, &[2]),
            Err(ProgramError::InvalidAccountData)
        );
    }
    assert_eq!(beneficiary_lamports, 123);
    assert_eq!(f.lamports, old_lamports);
    assert_eq!(u64::from_le_bytes(f.data[130..138].try_into().unwrap()), 0);
}
