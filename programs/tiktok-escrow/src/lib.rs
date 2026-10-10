//! SOL escrow for pump.fun creator-fee shareholders identified by a TikTok handle.
//!
//! The verification authority is an immutable PDA seed. Initializing a vault is
//! permissionless; claiming requires its permanently bound beneficiary's signature.
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const VAULT_LEN: usize = 138;
pub const MAGIC: &[u8; 8] = b"TIKVAULT";
pub const MAX_HANDLE_LEN: usize = 24;
const SEED: &[u8] = b"creator";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum EscrowError {
    InvalidHandle = 0,
    InvalidVault = 1,
    WrongVerifier = 2,
    AlreadyBound = 3,
    Unverified = 4,
    WrongBeneficiary = 5,
    InvalidIdentity = 6,
    Overflow = 7,
}

impl From<EscrowError> for ProgramError {
    fn from(error: EscrowError) -> Self {
        ProgramError::Custom(error as u32)
    }
}

#[derive(Debug)]
struct Vault {
    handle: Vec<u8>,
    verifier: Pubkey,
    beneficiary: Pubkey,
    total_claimed: u64,
}

fn valid_handle(handle: &[u8]) -> bool {
    !handle.is_empty()
        && handle.len() <= MAX_HANDLE_LEN
        && handle.last() != Some(&b'.')
        && handle
            .iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_' || *c == b'.')
}

fn require_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

fn require_writable(account: &AccountInfo) -> ProgramResult {
    if !account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn read_vault(program_id: &Pubkey, account: &AccountInfo) -> Result<Vault, ProgramError> {
    if account.owner != program_id || account.executable {
        return Err(EscrowError::InvalidVault.into());
    }
    let data = account.try_borrow_data()?;
    if data.len() != VAULT_LEN || &data[..8] != MAGIC {
        return Err(EscrowError::InvalidVault.into());
    }
    let handle_len = data[9] as usize;
    if handle_len == 0 || handle_len > MAX_HANDLE_LEN {
        return Err(EscrowError::InvalidVault.into());
    }
    let handle = data[10..10 + handle_len].to_vec();
    if !valid_handle(&handle) || data[10 + handle_len..34].iter().any(|b| *b != 0) {
        return Err(EscrowError::InvalidVault.into());
    }
    let verifier = Pubkey::new_from_array(data[34..66].try_into().unwrap());
    let beneficiary = Pubkey::new_from_array(data[66..98].try_into().unwrap());
    let identity_hash: [u8; 32] = data[98..130].try_into().unwrap();
    let total_claimed = u64::from_le_bytes(data[130..138].try_into().unwrap());
    let (address, bump) =
        Pubkey::find_program_address(&[SEED, verifier.as_ref(), &handle], program_id);
    if verifier == Pubkey::default()
        || address != *account.key
        || bump != data[8]
        || beneficiary == verifier
        || (beneficiary == Pubkey::default()) != (identity_hash == [0; 32])
        || (beneficiary == Pubkey::default() && total_claimed != 0)
    {
        return Err(EscrowError::InvalidVault.into());
    }
    Ok(Vault {
        handle,
        verifier,
        beneficiary,
        total_claimed,
    })
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    match data.first() {
        Some(0) => initialize(program_id, accounts, &data[1..]),
        Some(1) if data.len() == 33 => bind(program_id, accounts, data[1..].try_into().unwrap()),
        Some(2) if data.len() == 1 => claim(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn initialize(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let handle_len = data[0] as usize;
    if handle_len == 0 || handle_len > MAX_HANDLE_LEN || data.len() != 1 + handle_len + 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let handle = &data[1..1 + handle_len];
    if !valid_handle(handle) {
        return Err(EscrowError::InvalidHandle.into());
    }
    let verifier = Pubkey::new_from_array(data[1 + handle_len..].try_into().unwrap());
    if verifier == Pubkey::default() {
        return Err(EscrowError::WrongVerifier.into());
    }
    if accounts.len() != 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let accounts_iter = &mut accounts.iter();
    let payer = next_account_info(accounts_iter)?;
    let vault = next_account_info(accounts_iter)?;
    let system = next_account_info(accounts_iter)?;
    require_signer(payer)?;
    require_writable(payer)?;
    require_writable(vault)?;
    if *system.key != system_program::id() || !system.executable {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (address, bump) =
        Pubkey::find_program_address(&[SEED, verifier.as_ref(), handle], program_id);
    if address != *vault.key || payer.key == vault.key {
        return Err(EscrowError::InvalidVault.into());
    }
    if vault.owner == program_id {
        let existing = read_vault(program_id, vault)?;
        if existing.handle != handle || existing.verifier != verifier {
            return Err(EscrowError::InvalidVault.into());
        }
        return Ok(());
    }
    if vault.owner != &system_program::id() || !vault.data_is_empty() || vault.executable {
        return Err(EscrowError::InvalidVault.into());
    }

    // Allocate and assign separately: a prefunded PDA must not be able to block
    // initialization (system create_account fails when lamports already exist).
    let rent = Rent::get()?.minimum_balance(VAULT_LEN);
    let missing_rent = rent.saturating_sub(vault.lamports());
    if missing_rent != 0 {
        invoke(
            &system_instruction::transfer(payer.key, vault.key, missing_rent),
            &[payer.clone(), vault.clone(), system.clone()],
        )?;
    }
    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[SEED, verifier.as_ref(), handle, &bump_seed];
    invoke_signed(
        &system_instruction::allocate(vault.key, VAULT_LEN as u64),
        &[vault.clone(), system.clone()],
        &[seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(vault.key, program_id),
        &[vault.clone(), system.clone()],
        &[seeds],
    )?;
    let mut bytes = vault.try_borrow_mut_data()?;
    if bytes.len() != VAULT_LEN || vault.owner != program_id {
        return Err(EscrowError::InvalidVault.into());
    }
    bytes.fill(0);
    bytes[..8].copy_from_slice(MAGIC);
    bytes[8] = bump;
    bytes[9] = handle_len as u8;
    bytes[10..10 + handle_len].copy_from_slice(handle);
    bytes[34..66].copy_from_slice(verifier.as_ref());
    Ok(())
}

fn bind(program_id: &Pubkey, accounts: &[AccountInfo], identity_hash: [u8; 32]) -> ProgramResult {
    if accounts.len() != 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let verifier = &accounts[0];
    let beneficiary = &accounts[1];
    let vault = &accounts[2];
    require_signer(verifier)?;
    require_signer(beneficiary)?;
    require_writable(vault)?;
    let state = read_vault(program_id, vault)?;
    if state.verifier != *verifier.key {
        return Err(EscrowError::WrongVerifier.into());
    }
    if state.beneficiary != Pubkey::default() {
        return Err(EscrowError::AlreadyBound.into());
    }
    if identity_hash == [0; 32]
        || *beneficiary.key == Pubkey::default()
        || beneficiary.key == verifier.key
        || beneficiary.key == vault.key
    {
        return Err(EscrowError::InvalidIdentity.into());
    }
    let mut data = vault.try_borrow_mut_data()?;
    data[66..98].copy_from_slice(beneficiary.key.as_ref());
    data[98..130].copy_from_slice(&identity_hash);
    Ok(())
}

fn claim(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.len() != 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let beneficiary = &accounts[0];
    let vault = &accounts[1];
    require_signer(beneficiary)?;
    require_writable(beneficiary)?;
    require_writable(vault)?;
    let state = read_vault(program_id, vault)?;
    if state.beneficiary == Pubkey::default() {
        return Err(EscrowError::Unverified.into());
    }
    if state.beneficiary != *beneficiary.key || beneficiary.key == vault.key {
        return Err(EscrowError::WrongBeneficiary.into());
    }
    let amount = vault
        .lamports()
        .saturating_sub(Rent::get()?.minimum_balance(VAULT_LEN));
    let total = state
        .total_claimed
        .checked_add(amount)
        .ok_or(EscrowError::Overflow)?;
    let beneficiary_balance = beneficiary
        .lamports()
        .checked_add(amount)
        .ok_or(EscrowError::Overflow)?;
    let vault_balance = vault
        .lamports()
        .checked_sub(amount)
        .ok_or(EscrowError::Overflow)?;

    // Obtain every mutable borrow and check every overflow before changing state.
    let mut data = vault.try_borrow_mut_data()?;
    let mut destination = beneficiary.try_borrow_mut_lamports()?;
    let mut source = vault.try_borrow_mut_lamports()?;
    data[130..138].copy_from_slice(&total.to_le_bytes());
    **destination = beneficiary_balance;
    **source = vault_balance;
    Ok(())
}

#[cfg(test)]
mod tests;
