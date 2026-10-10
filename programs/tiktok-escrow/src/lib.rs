//! SOL escrow for pump.fun creator-fee shareholders identified by a TikTok handle.
//!
//! The verification authority is an immutable PDA seed. Initializing a vault is
//! permissionless; claiming requires its permanently bound beneficiary's signature.
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
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
pub const APPROVED_MAGIC: &[u8; 8] = b"TIKAPPRV";
pub const PROOF_MAGIC: &[u8; 8] = b"TIKPROOF";
pub const PROOF_LEN: usize = 143;
pub const PROOF_TTL_SECONDS: i64 = 48 * 60 * 60;
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
    InvalidProof = 8,
    ProofExists = 9,
    ProofExpired = 10,
    VideoRequired = 11,
    ApprovalPending = 12,
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
    approved: bool,
    identity_hash: [u8; 32],
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
    if data.len() != VAULT_LEN || (&data[..8] != MAGIC && &data[..8] != APPROVED_MAGIC) {
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
    let approved = &data[..8] == APPROVED_MAGIC;
    let (address, bump) =
        Pubkey::find_program_address(&[SEED, verifier.as_ref(), &handle], program_id);
    if verifier == Pubkey::default()
        || address != *account.key
        || bump != data[8]
        || beneficiary == verifier
        || (beneficiary == Pubkey::default()) != (identity_hash == [0; 32])
        || (beneficiary == Pubkey::default() && total_claimed != 0)
        || (approved && (beneficiary == Pubkey::default() || total_claimed != 0))
    {
        return Err(EscrowError::InvalidVault.into());
    }
    Ok(Vault {
        handle,
        verifier,
        beneficiary,
        total_claimed,
        approved,
        identity_hash,
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
        Some(3) => request_proof(program_id, accounts, &data[1..]),
        Some(4) => attach_video(program_id, accounts, &data[1..]),
        Some(5) if data.len() == 33 => {
            approve_proof(program_id, accounts, data[1..].try_into().unwrap())
        }
        Some(6) if data.len() == 1 => cancel_proof(program_id, accounts),
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
    require_signer(beneficiary)?;
    require_writable(vault)?;
    let state = read_vault(program_id, vault)?;
    if state.verifier != *verifier.key {
        return Err(EscrowError::WrongVerifier.into());
    }
    if state.approved {
        if state.beneficiary != *beneficiary.key {
            return Err(EscrowError::WrongBeneficiary.into());
        }
        if state.identity_hash != identity_hash {
            return Err(EscrowError::InvalidIdentity.into());
        }
        vault.try_borrow_mut_data()?[..8].copy_from_slice(MAGIC);
        return Ok(());
    }
    // OAuth binding remains available only with both signatures. Manual proof
    // activation above uses the creator's prior consent and admin approval.
    require_signer(verifier)?;
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
    if state.approved {
        return Err(EscrowError::ApprovalPending.into());
    }
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

struct Proof {
    handle: Vec<u8>,
    verifier: Pubkey,
    beneficiary: Pubkey,
    nonce: [u8; 16],
    created_at: i64,
    video_id: Vec<u8>,
}

fn read_proof(program_id: &Pubkey, account: &AccountInfo) -> Result<Proof, ProgramError> {
    if account.owner != program_id || account.executable {
        return Err(EscrowError::InvalidProof.into());
    }
    let data = account.try_borrow_data()?;
    if data.len() != PROOF_LEN || &data[..8] != PROOF_MAGIC {
        return Err(EscrowError::InvalidProof.into());
    }
    let length = data[9] as usize;
    if length == 0 || length > MAX_HANDLE_LEN {
        return Err(EscrowError::InvalidProof.into());
    }
    let handle = data[10..10 + length].to_vec();
    let verifier = Pubkey::new_from_array(data[34..66].try_into().unwrap());
    let beneficiary = Pubkey::new_from_array(data[66..98].try_into().unwrap());
    let nonce: [u8; 16] = data[98..114].try_into().unwrap();
    let created_at = i64::from_le_bytes(data[114..122].try_into().unwrap());
    let video_len = data[122] as usize;
    if !valid_handle(&handle)
        || data[10 + length..34].iter().any(|b| *b != 0)
        || verifier == Pubkey::default()
        || beneficiary == Pubkey::default()
        || beneficiary == verifier
        || nonce == [0; 16]
        || created_at < 0
        || created_at.checked_add(PROOF_TTL_SECONDS).is_none()
        || video_len > 20
        || data[123..123 + video_len]
            .iter()
            .any(|b| !b.is_ascii_digit())
        || (video_len > 0 && data[123] == b'0')
        || data[123 + video_len..143].iter().any(|b| *b != 0)
    {
        return Err(EscrowError::InvalidProof.into());
    }
    let (address, bump) = Pubkey::find_program_address(
        &[b"proof", verifier.as_ref(), &handle, beneficiary.as_ref()],
        program_id,
    );
    if *account.key != address || data[8] != bump {
        return Err(EscrowError::InvalidProof.into());
    }
    Ok(Proof {
        handle,
        verifier,
        beneficiary,
        nonce,
        created_at,
        video_id: data[123..123 + video_len].to_vec(),
    })
}

fn require_current_proof(proof: &Proof) -> ProgramResult {
    let now = Clock::get()?.unix_timestamp;
    if now < proof.created_at
        || now
            >= proof
                .created_at
                .checked_add(PROOF_TTL_SECONDS)
                .ok_or(EscrowError::InvalidProof)?
    {
        return Err(EscrowError::ProofExpired.into());
    }
    Ok(())
}

fn request_proof(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let handle_len = *data.first().ok_or(ProgramError::InvalidInstructionData)? as usize;
    if handle_len == 0 || handle_len > MAX_HANDLE_LEN || data.len() != 1 + handle_len + 16 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let handle = &data[1..1 + handle_len];
    let nonce: [u8; 16] = data[1 + handle_len..].try_into().unwrap();
    if !valid_handle(handle) || nonce == [0; 16] {
        return Err(EscrowError::InvalidProof.into());
    }
    if accounts.len() != 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let beneficiary = &accounts[0];
    let proof = &accounts[1];
    let vault = &accounts[2];
    let verifier = &accounts[3];
    let system = &accounts[4];
    require_signer(beneficiary)?;
    require_writable(beneficiary)?;
    require_writable(proof)?;
    let state = read_vault(program_id, vault)?;
    if state.verifier != *verifier.key || state.handle != handle {
        return Err(EscrowError::WrongVerifier.into());
    }
    if state.beneficiary != Pubkey::default() || state.approved {
        return Err(EscrowError::AlreadyBound.into());
    }
    if *beneficiary.key == Pubkey::default() || beneficiary.key == verifier.key {
        return Err(EscrowError::InvalidIdentity.into());
    }
    if *system.key != system_program::id() || !system.executable {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (address, bump) = Pubkey::find_program_address(
        &[
            b"proof",
            verifier.key.as_ref(),
            handle,
            beneficiary.key.as_ref(),
        ],
        program_id,
    );
    if address != *proof.key || proof.key == beneficiary.key {
        return Err(EscrowError::InvalidProof.into());
    }
    if proof.owner == program_id {
        let existing = read_proof(program_id, proof)?;
        require_current_proof(&existing)?;
        if existing.nonce != nonce {
            return Err(EscrowError::ProofExists.into());
        }
        return Ok(());
    }
    if proof.owner != &system_program::id() || !proof.data_is_empty() || proof.executable {
        return Err(EscrowError::InvalidProof.into());
    }
    let now = Clock::get()?.unix_timestamp;
    if now < 0 || now.checked_add(PROOF_TTL_SECONDS).is_none() {
        return Err(EscrowError::InvalidProof.into());
    }
    let rent = Rent::get()?.minimum_balance(PROOF_LEN);
    let missing = rent.saturating_sub(proof.lamports());
    if missing != 0 {
        invoke(
            &system_instruction::transfer(beneficiary.key, proof.key, missing),
            &[beneficiary.clone(), proof.clone(), system.clone()],
        )?;
    }
    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[
        b"proof",
        verifier.key.as_ref(),
        handle,
        beneficiary.key.as_ref(),
        &bump_seed,
    ];
    invoke_signed(
        &system_instruction::allocate(proof.key, PROOF_LEN as u64),
        &[proof.clone(), system.clone()],
        &[seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(proof.key, program_id),
        &[proof.clone(), system.clone()],
        &[seeds],
    )?;
    let mut bytes = proof.try_borrow_mut_data()?;
    if bytes.len() != PROOF_LEN || proof.owner != program_id {
        return Err(EscrowError::InvalidProof.into());
    }
    bytes.fill(0);
    bytes[..8].copy_from_slice(PROOF_MAGIC);
    bytes[8] = bump;
    bytes[9] = handle_len as u8;
    bytes[10..10 + handle_len].copy_from_slice(handle);
    bytes[34..66].copy_from_slice(verifier.key.as_ref());
    bytes[66..98].copy_from_slice(beneficiary.key.as_ref());
    bytes[98..114].copy_from_slice(&nonce);
    bytes[114..122].copy_from_slice(&now.to_le_bytes());
    Ok(())
}

fn attach_video(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let length = *data.first().ok_or(ProgramError::InvalidInstructionData)? as usize;
    if length == 0
        || length > 20
        || data.len() != 1 + length
        || data[1] == b'0'
        || data[1..].iter().any(|b| !b.is_ascii_digit())
    {
        return Err(ProgramError::InvalidInstructionData);
    }
    if accounts.len() != 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let beneficiary = &accounts[0];
    let proof = &accounts[1];
    require_signer(beneficiary)?;
    require_writable(proof)?;
    let state = read_proof(program_id, proof)?;
    if state.beneficiary != *beneficiary.key {
        return Err(EscrowError::WrongBeneficiary.into());
    }
    require_current_proof(&state)?;
    let mut bytes = proof.try_borrow_mut_data()?;
    bytes[122] = length as u8;
    bytes[123..].fill(0);
    bytes[123..123 + length].copy_from_slice(&data[1..]);
    Ok(())
}

fn approve_proof(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    expected_hash: [u8; 32],
) -> ProgramResult {
    if accounts.len() != 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let verifier = &accounts[0];
    let proof = &accounts[1];
    let vault = &accounts[2];
    let beneficiary = &accounts[3];
    require_signer(verifier)?;
    require_writable(proof)?;
    require_writable(vault)?;
    require_writable(beneficiary)?;
    let state = read_proof(program_id, proof)?;
    let vault_state = read_vault(program_id, vault)?;
    if state.verifier != *verifier.key
        || vault_state.verifier != state.verifier
        || vault_state.handle != state.handle
    {
        return Err(EscrowError::WrongVerifier.into());
    }
    if state.beneficiary != *beneficiary.key
        || beneficiary.key == proof.key
        || beneficiary.key == vault.key
    {
        return Err(EscrowError::WrongBeneficiary.into());
    }
    require_current_proof(&state)?;
    if state.video_id.is_empty() {
        return Err(EscrowError::VideoRequired.into());
    }
    if vault_state.beneficiary != Pubkey::default() || vault_state.approved {
        return Err(EscrowError::AlreadyBound.into());
    }
    let identity_hash = solana_program::hash::hash(&proof.try_borrow_data()?).to_bytes();
    // The admin signs the exact record they reviewed. Updating the video or
    // canceling/recreating a proof at the same PDA invalidates this approval.
    if identity_hash == [0; 32] || identity_hash != expected_hash {
        return Err(EscrowError::InvalidIdentity.into());
    }
    let refund = beneficiary
        .lamports()
        .checked_add(proof.lamports())
        .ok_or(EscrowError::Overflow)?;
    // Acquire every borrow and check all invariants before changing either state.
    let mut vault_data = vault.try_borrow_mut_data()?;
    let mut proof_data = proof.try_borrow_mut_data()?;
    let mut destination = beneficiary.try_borrow_mut_lamports()?;
    let mut source = proof.try_borrow_mut_lamports()?;
    vault_data[..8].copy_from_slice(APPROVED_MAGIC);
    vault_data[66..98].copy_from_slice(beneficiary.key.as_ref());
    vault_data[98..130].copy_from_slice(&identity_hash);
    proof_data.fill(0);
    **destination = refund;
    **source = 0;
    Ok(())
}

fn cancel_proof(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.len() != 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let beneficiary = &accounts[0];
    let proof = &accounts[1];
    require_signer(beneficiary)?;
    require_writable(beneficiary)?;
    require_writable(proof)?;
    let state = read_proof(program_id, proof)?;
    if state.beneficiary != *beneficiary.key || beneficiary.key == proof.key {
        return Err(EscrowError::WrongBeneficiary.into());
    }
    // Cancel remains available after expiry; no SOL is stranded by the deadline.
    let refund = beneficiary
        .lamports()
        .checked_add(proof.lamports())
        .ok_or(EscrowError::Overflow)?;
    let mut data = proof.try_borrow_mut_data()?;
    let mut destination = beneficiary.try_borrow_mut_lamports()?;
    let mut source = proof.try_borrow_mut_lamports()?;
    data.fill(0);
    **destination = refund;
    **source = 0;
    Ok(())
}

#[cfg(test)]
mod tests;
