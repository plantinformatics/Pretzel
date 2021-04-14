#!/usr/bin/perl
#!/bin/sh
#exec perl -w -x $0
#!perl

#-------------------------------------------------------------------------------
# Convert Exome SNPs to JSON Pretzel format for upload.
# input format, e.g :
# chr1A	22298	scaffold38755_22298	T/C
# chr1A	22304	scaffold38755_22304	A/G
#
# initial version based on effects2Dataset.pl (a6e96c6)

#-------------------------------------------------------------------------------

use strict;
use warnings;

use Getopt::Std;	# for getopt()


#-------------------------------------------------------------------------------

# Forward declarations
sub convertInput();
sub createDataset();
sub appendToBlock();
sub makeTemplates();

#-------------------------------------------------------------------------------
# main


## Get options from ARGV
my %options;
getopts("vhd:p:b:n:c:s:C:F:P:gM:R:", \%options);

## Version and help options display
use constant versionMsg => "2020 Dec 07 (Don Isdale).\n";
use constant usageMsg => <<EOF;
  Usage e.g. : $0 [-d Exome_SNPs_1A -p Triticum_aestivum_IWGSC_RefSeq_v1.0 ] _or_ -b blockId  < IWGSC_RefSeq_v1.0.EXOME_SNPs.chr1A.tsv > Exome_SNPs_1A.json
  Optional params : -n namespace [empty | 90k | ... ]  -c "common name"
  -C columnsKeyString e.g. "chr pos name ref_alt"
  -F field separator, e.g. '\t', default ','
  -P species prefix for chr number, e.g. Ca
  -M column for dataset from Metadata worksheet csv
  -R Chromosome Renaming worksheet csv
EOF

my $datasetName = $options{d};
my $parentName = $options{p};
my $blockId = $options{b};
# may be '', which is false-y
my $namespace = defined($options{n}) ? $options{n} : (defined($parentName) ? "$parentName:$datasetName" : $datasetName);
my $commonName = $options{c};
my $shortName = $options{s};	# option, Exome. WGS
my $columnsKeyString = $options{C} || "chr pos name ref_alt";

my $fieldSeparator = $options{F} || ',';	# '\t'
# Prefix the chr with e.g. 2-letter abbreviation of latin name (e.g. 'Ca')
# The chr input may be just a number, or it may have some other prefix which is trimmed off (see $chrPrefix).
my $chrOutputPrefix = $options{P} || '';

my $datasetMetaFile = $options{M};
my $chromosomeRenamingFile = $options{R};

#my $refAltSlash = 0;	# option, default 0
# true means add other columns to Feature.values { }
my $addValues = 1;	# option : add values : { other columns, }
# option : if  $namespace =~ m/90k/ etc,  use  $datasetHeaderGM
my $isGM = $options{g}; # default 0, 1 for physical data blocks


my $extraTags = ''; # '"SNP"';  #  . ", \"HighDensity\"";	# option, default ''

# For loading Genome Reference / Parent :
# my $extraMeta = ''; # '"paths" : "false",'; # '"type" : "Genome",';

#-------------------------------------------------------------------------------

# initialised by makeTemplates()
my $datasetHeader;
my $blockHeader;
my $blockFooter;
my $datasetFooter;
my $datasetHeaderGM;

#-------------------------------------------------------------------------------

if ($options{v}) {
  print versionMsg;
}
elsif ($options{h})
{
  print usageMsg;
}
elsif (defined ($datasetName) == defined ($blockId))
{
  print usageMsg, <<EOF;
  Required option : -d dataset name or -b block name (not both)
EOF
}
# Maybe drop this test - allow parentName to be optional.
elsif (0 && (defined ($parentName) == defined ($blockId)))
{
  print usageMsg, <<EOF;
  Required option : -p parent (reference dataset) name or -b block name (not both)
EOF
}
else
{
  makeTemplates();

  if (! defined ($blockId))
    { 
      createDataset();
    }
  else
    {
      appendToBlock();
    }
}

#-------------------------------------------------------------------------------


# Define enum-like constants for the indexes of the input columns.
# Not fully used, c_char is used in snpLine(), but printFeature() unpacks the input fields directly using shift @a.
#   based on: https://stackoverflow.com/a/25512227, kbro
# Prefix some of the enum names with c_ (column) to avoid namespace clash with e.g. perl chr().
# data example : chr1A	22298	scaffold38755_22298	T/C
# scaffold_pos -> name
# $columnsKeyString = "chr pos name ref_alt";

#SNP_20002403,LG7.2,40.5
#PBA_LC_0373,LG7.3,0
#SSR184,LG7.3,1.9
#SNP_20004741,LG7.3,7.2
# $columnsKeyString = "name chr pos";
# This may be a requirement :
# my $chrPrefix = 'L.';
# Assumption : if chr has 2 '.' after $chrPrefix then scope is : trim off the 2nd . and following chars.
#Lc_ILL_00694,L.5.1,480.1670411
#Lc_ILL_00714,L.5.2,0
#Lc_ILL_00037,L.5.2,4.321070321


# equivalent to e.g : qw(c_chr c_pos c_name c_ref_alt)
# /r for non-destructive, allows chaining.
my $columnsKeyPrefixed;
my $c_endPos;

BEGIN
{
  # $columnsKeyString indicates which columns contain the key values
  # e.g. "chr name pos" or "name chr pos end" or "chr pos name ref_alt"
  $columnsKeyString  = $ENV{columnsKeyString} || "chr name pos";
  $columnsKeyPrefixed = $columnsKeyString
    =~ s/,/ /rg
    =~ s/^/c_/r
    =~ s/ / c_/rg;

  # Define a variable $c_endPos, because the enum c_endPos can't have a conditional value.
  # Using an enum made sense in the initial version which had fixed columns,
  # but now %columnsKeyLookup is more suitable.
  #
  # $columnsKeyString is space-separated, not comma.
  my @columnsKeyValues = split(' ', $columnsKeyString);
  my %columnsKeyLookup;
  for (my $ki=0; $ki <= $#columnsKeyValues; $ki++)
  {
    $columnsKeyLookup{$columnsKeyValues[$ki]} = $ki;
  }
  $c_endPos = defined($columnsKeyLookup{'end'}) ? $columnsKeyLookup{'end'} : undef;
}
use constant ColumnsEnum => split(' ', $columnsKeyPrefixed);
BEGIN
{
  eval "use constant (ColumnsEnum)[$_] => $_;" foreach 0..(ColumnsEnum)-1;
  eval "use constant c_start => c_pos;";
}


#-------------------------------------------------------------------------------

my @columnHeaders;

# @return true if the given line is a column header row
sub headerLine($$) {
  my ($line, $lineNumber) = @_;
  my $isHeader = ($lineNumber == 1) &&
    (
     ($line =~ m/^label	chr	pos/)
     || ($line =~ m/^name,chr,pos/)
     || (($line =~ m/Marker|Name/i) && ($line =~ m/Chromosome/i))
     || ($line =~ m/Contig,Position/i)
    );
  if ($isHeader) {
    @columnHeaders = split(',');
  }
  return $isHeader;
}

#-------------------------------------------------------------------------------

# Sanitize input by removing punctuation other than space, comma, _, ., /, \n
# Commonly _ and . are present in parentName.
# Space appears in commonName (handled in .bash).
# , is used for splitting csv lines, and / appears in some chr names e.g. 'LG5/LG7'
# Related : deletePunctuation() in uploadSpreadsheet.bash
sub deletePunctuation($)
{
  my ($text) = @_;
  $text =~ tr/_.,\/\n 0-9A-Za-z//cd;
  return $text;
}


# hash -> json
# Only need simple 1-level json output, so implement it here to avoid installing JSON.pm.
sub simple_encode_json($)
{
  my ($data) = @_;
  my @fields = ();
  for my $key (keys %$data) {
    push @fields, '"' . $key . '" : "' . $data->{$key} . '"';
  }
  return @fields;
}

# Populate Dataset .meta from command-line options and
# column for dataset from Metadata worksheet.
sub setupMeta()
{
  my %meta = ();

  if (defined($shortName) && $shortName)
  {
    $meta{'shortName'} = $shortName;
  }
  if (defined($commonName) && $commonName)
  {
    $meta{'commonName'} = $commonName;
  }
  # When called from uploadSpreadsheet.bash, meta.type can now be set from the Metadata worksheet.
  if ($isGM) {
    $meta{'type'} = "Genetic Map";
  }

  #-----------------------------------------------------------------------------
  # Read additional meta from file.
  if (defined($datasetMetaFile) && $datasetMetaFile)
  {
    if (! open(FH, '<', $datasetMetaFile))
    { warn $!; }
    else
    {
      while(<FH>){
        chomp;
        my ($fieldName, $value) = split(/,/, $_);
        if (! ($fieldName =~ m/commonName|parentName|platform|shortName/)) {
          $meta{$fieldName} = $value;
        }
      }
      close(FH);
    }
  }

  # use JSON;
  # my $metaJson = encode_json \%meta;
  my $metaJson = '{' . join(",\n        ", simple_encode_json(\%meta)) . '}';

  return $metaJson;
}

sub makeTemplates()
{
  my $metaJson = setupMeta();
  # Result %chromosomeRenames is used in snpLine().
  chromosomeRenamePrepare();

  # Could include . "\n" in this expression, but OTOH there is some
  # value in leaving blank lines when parent and namespace are not defined.
  # (the template does contain the indent spaces so the line is blank but not empty).
  my $parentJson = defined($parentName) ? '"parent" : "' . $parentName . '",' : '';
  my $namespaceJson = defined($namespace) ? '"namespace" : "' . $namespace . '",' : '';


# Used to form the JSON structure of datasets and blocks.
# Text extracted from pretzel-data/myMap.json
# These are indented with 4 spaces, whereas the remainder of the file is indented with 2-column tab positions.
$datasetHeader = <<EOF;
{
    "name": "$datasetName",
    "type": "linear",
    "tags": [
        $extraTags
    ],
    $parentJson
    $namespaceJson
    "meta" : $metaJson,
    "blocks": [
EOF

$datasetHeaderGM = <<EOF;
{
    "name": "$datasetName",
    $namespaceJson
    "meta" : $metaJson,
    "blocks": [
EOF



# omitted :
#            "namespace": "90k",
sub blockHeader($)
{
  my ($chromosomeRenamedFrom) = @_;
  my $indent = '            ';
  # blockMeta is '', or json meta containing chromosomeRenamedFrom.
  # Use of simple_encode_json() in setupMeta() is related;  factor if more fields added.
  my $blockMeta = (defined($chromosomeRenamedFrom) && $chromosomeRenamedFrom) ?
"\n" . $indent . '"meta" : { "chromosomeRenamedFrom" : "' . $chromosomeRenamedFrom . '" },'
    : '';
  my $text = <<EOF;
        {
            "name": "blockName",
            "scope": "blockScope",$blockMeta
            "features": [

EOF
  return $text;
}

$blockFooter = <<EOF;
            ]
        }
EOF

$datasetFooter = <<EOF;

    ]
}
EOF

}

#-------------------------------------------------------------------------------

# Value of chr (chromosome) on the previous line, or undefined on the first line
my $lastChr;
my $blockSeparator;

#-------------------------------------------------------------------------------

sub createDataset()
{
  if ($isGM) {
    $datasetHeader = $datasetHeaderGM;
  }

  print $datasetHeader;

  convertInput();

  optionalBlockFooter();
  print $datasetFooter;
}
sub appendToBlock()
{
  # related : $blockHeader
  print "{\n  \"blockId\" : \"$blockId\",\n",
    "  \"features\": [\n";

  convertInput();

  print $blockFooter;
}
sub convertInput()
{
  while (<>)
    {
      chomp;
      # commenting out this condition will output the column headers in the JSON,
      # which is a useful check of column alignment with the ColumnsEnum.
      if (@columnHeaders || ! headerLine($_, $.))
        { snpLine($_); }
    }
}

sub optionalBlockFooter()
{
  if (defined($lastChr))
    { print $blockFooter; }
}

#-------------------------------------------------------------------------------

my %chromosomeRenames;
# Read $chromosomeRenamingFile 
sub chromosomeRenamePrepare($)
{
  if (defined($chromosomeRenamingFile) && $chromosomeRenamingFile)
  {
    if (! open(FH, '<', $chromosomeRenamingFile))
    { warn $!; }
    else
    {
      while(<FH>){
        chomp;
        # deletePunctuation() is applied to both $fromName and $toName.
        # $fromName is used as an array index, whereas $toName is
        # simply inserted into the json output, so is perhaps lower risk.
        my ($fromName, $toName) = split(/,/, deletePunctuation($_));
        $chromosomeRenames{$fromName} = $toName;
      }
      close(FH);
    }
  }
}


#-------------------------------------------------------------------------------

my $chromosomeRenamedFrom;
# read 1 line, which defines a SNP and associated reference/alternate data
sub snpLine($)
{
  my ($line) = @_;
  # input line e.g.
  #c_chr c_pos c_name c_ref_alt
  #chr1A	22298	scaffold38755_22298	T/C

  my @a =  split($fieldSeparator, $line);

  $a[c_chr] = trimOutsideQuotesAndSpaces($a[c_chr]);
  # tsv datasets often follow the naming convention 'chr1A';  Pretzel data omits 'chr' for block scope & name : '1A'.
  if (! %chromosomeRenames)
  {
    $a[c_chr] =~ s/^chr//;
    $a[c_chr] = $chrOutputPrefix . $a[c_chr];
  }
  else
  # Apply %chromosomeRenames
  {
    # deletePunctuation() is applied to $fromName in chromosomeRenamePrepare(),
    # so applying it equally here to $a[c_chr] enables fromName containing punctuation to match,
    # e.g. genbank ids contain '|'.
    my $toName = $chromosomeRenames{deletePunctuation($a[c_chr])};
    if (defined($toName))
    {
      $chromosomeRenamedFrom = $a[c_chr];
      $a[c_chr] = $toName;
    }
  }

  $a[c_name] = markerPrefix(trimOutsideQuotesAndSpaces($a[c_name]));

  my $c = $a[c_chr];
  if (! defined($lastChr) || ($lastChr ne $c))
    {
      if (defined($blockId))
        {
          $lastChr = $c;
        }
      else
        {
          optionalBlockFooter();

          # print $c;
          $lastChr = $c;

          if (defined($blockSeparator))
            { print $blockSeparator; }
          else
            { $blockSeparator = ",\n"; }

          my $h = blockHeader($chromosomeRenamedFrom);
          # replace 'blockName' in the $blockHeader template with the actual chromosome name $c.
          # and blockScope with : the scope which is the chr $c with .[1-9] trimmed off
          # or scope might be just the chr name $c so that each GM block gets its own axis.
          my $scope = $c;   #  ($c =~ s/\.[1-9]$//r);
          $h =~ s/blockName/$c/g;
          $h =~ s/blockScope/$scope/g;
          print $h;
        }
    }
  else # print feature separator
    { print ","; }
  printFeature(@a);
}

# Strip off outside " and spaces, to handle e.g.
#   "LG4 ",Ca_2289,0
#   Ps_ILL_03447,"LG 2",0
# Used for name (label) and chr (chromosome / block) name columns.
sub trimOutsideQuotesAndSpaces($) {
  my ($label) = @_;
  if ($label =~ m/"/) {
    $label =~ s/^"//;
    $label =~ s/"$//;
    }
  if ($label =~ m/ /) {
    $label =~ s/^ //;
    $label =~ s/ $//;
    }
  return $label;
}

# Illumina OPA SNP names are [1234]000 or SNP_[1234]000.
# Prefix with SNP_ if not present, to make all consistent.
sub markerPrefix($) {
  my ($name) = @_;
  if ($name =~ m/^[1234]000/)
  {
    $name = "SNP_" . $name;
  }
  return $name
}

# @return true if the given string has a leading # or "#
# i.e. is a comment.
# related : filterOutComments() (backend/scripts/uploadSpreadsheet.bash)
sub isComment($)
{
  my ($columnHeader) = @_;
  return $columnHeader =~ m/^#|^"#/;
}

# Recognise decimal fraction aliasing and round the number. 
#
# ssconvert apparently has different rounding to libreoffice, as the former
# expresses some decimal fractions with recurring 0 or 9.
# e.g comparing output from libreoffice and ssconvert respectively 
#   < SNP_40002085,LG1,1.3
#   > SNP_40002085,LG1,1.2999999999999998
#   < SNP_40001996,LG1,7.6
#   > SNP_40001996,LG1,7.6000000000000005
#
# ssconvert handles multiple work-sheets within the .xslx, but libreoffice does not.
#
# If the number has a few decimal digits in the source spreadsheet, then
# the number of 0-s or 9-s to match here may be as few as 11. match a minimum of 6.
# The SNP / marker name may also contain 4 0-s, but that is a different column and they are unlikely to have 8.
sub roundPosition($)
{
  my ($pos) = @_;
  if ($pos =~ m/000000|999999/) {
    $pos = (sprintf('%.8f', $pos) =~ s/0+$//r =~ s/\.$//r);
    }
  return $pos;
}


# For printing array as comma-separated list.
# Could make this local if it clashed with any other print.
# As an alternative to using join to construct $aCsv in printFeature(), can do :
# $,=",";
# then print @a; but it doesn't work within <<EOF.
# $"=",";	# applies to print "@a"

sub printFeature($)
{
  my (@a) = @_;

  # No longer removing key values from @a, so $ak can be simply $a.
  # Copy the essential / key columns; remainder may go in .values.
  my (@ak) = ();

  my $c;
  for $c (c_name, c_chr, c_pos, c_start, $c_endPos)
    {
      if (defined($c)) {
        $ak[$c] = $a[$c];
      }
    }

  my %values = ();
  if ($addValues)
  {
    # could also match @columnHeaders
    for (my $ci=0; $ci <= $#a; $ci++)
    {
      # if the column is not already used (one of the essential/"key"
      # columns), and the value is non-empty, and it has a column heading,
      # then add it to .values
      if (($ci != c_name) && ($ci != c_chr) && ($ci != c_pos) && ($ci != c_start) && (! defined($c_endPos) || ($ci != $c_endPos))
          && $a[$ci] && ($ci <= $#columnHeaders) && $columnHeaders[$ci] && ! isComment($columnHeaders[$ci]))
      {
        $values{$columnHeaders[$ci]} = $a[$ci];
      }
    }
  }

  # Round the numeric (position) columns.
  for $c (c_pos, c_start, $c_endPos)
    {
      if (defined($c) && defined($ak[$c]))
        {
          $ak[$c] = roundPosition($ak[$c]);
        }
    }
  # Either pos or (start & end) may be provided.
  # Copy pos to start & end if they are not defined.
  my $start = defined(c_pos) ? $ak[c_pos] : $ak[c_start];
  # Wrapping use of index which may be undefined with eval; otherwise
  # it gets an error on initial program parse even though it is not
  # evaluated
  my $end = (defined($c_endPos) && $ak[$c_endPos]) ||
    (defined(c_pos) && $ak[c_pos]);
  # In Pretzel the end position is optional but the start position is required.
  if ((! $start || ($start eq "n/a")) && $end)
  {
    $start = $end;
  }


  my $indent = "                    ";
  my $valuesString = $addValues && %values ?
    ",\n" . $indent . "\"values\" : {"
    . join(",\n        ", simple_encode_json(\%values)) .
    "}"
    : '';
  my $name = eval '$ak[c_name]';

  print <<EOF;
               {
                    "name": "$name",
                    "value": [
                        $start,
                        $end
                    ],
                    "value_0": $start$valuesString
                }
EOF

}

#-------------------------------------------------------------------------------
# Indentation.
#
# emacs (GNU style) :
# Local Variables:
# perl-indent-level: 2
# perl-continued-statement-offset: 2
# perl-continued-brace-offset: 0
# End:
#
# Now indented using spaces not TAB characters, previously tab-width 2, or
# vim: set tabstop=2 shiftwidth=2 noexpandtab: 
#-------------------------------------------------------------------------------
