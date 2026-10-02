#![feature(f16)]

mod benchmark;
mod cli;
mod config;
mod context;
mod db;
mod host;
mod kernel;
mod machine;
mod plan;
mod report;

use clap::{CommandFactory, Parser};

use crate::cli::Cli;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    if cli.is_unpinned() {
        Cli::command().print_help()?;
        return Ok(());
    }
    let mut plan = cli.into_plan()?;
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
    )?;
    eprintln!(
        "Wrote {} measurements to {}",
        records.len(),
        plan.output_path.display()
    );
    Ok(())
}
