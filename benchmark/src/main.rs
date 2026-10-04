#![feature(f16)]

mod benchmark;
mod cli;
mod config;
mod context;
mod db;
mod host;
mod hwinfo;
mod kernel;
mod plan;
mod report;
mod validate;

use clap::{CommandFactory, Parser};

use crate::cli::{Cli, Command};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    if let Some(Command::Validate { dbs }) = &cli.command {
        return validate::validate_all(dbs).map_err(Into::into);
    }
    if cli.is_unpinned() {
        Cli::command().print_help()?;
        return Ok(());
    }
    let mut plan = cli.into_plan()?;
    println!("{}", plan.machine.summary());
    for notice in &plan.skipped {
        eprintln!("{notice}");
    }
    let records = benchmark::run(&plan)?;

    report::print_results_table(&records);
    db::write_run(
        &mut plan.db,
        &plan.context,
        plan.repetitions,
        &plan.machine,
        &records,
    )
    .map_err(|error| {
        format!(
            "cannot write the run to '{}': {error}. Nothing was saved: the results table above is the only copy of this run",
            plan.output_path.display()
        )
    })?;
    eprintln!(
        "Wrote {} measurements to {}",
        records.len(),
        plan.output_path.display()
    );
    Ok(())
}
