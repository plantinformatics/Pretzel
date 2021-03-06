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
use Scalar::Util qw/reftype/;

#-------------------------------------------------------------------------------

# Forward declarations
sub convertInput();
sub createDataset();
sub appendToBlock();
sub makeTemplates();
sub encode_json_2($$);
sub columnConfig();
sub chromosomeRenamePrepare();

#-------------------------------------------------------------------------------

# Handles dynamic / optional columns, in place of ColumnsEnum.
my %columnsKeyLookup = ();
my $c_arrayColumnName;

#-------------------------------------------------------------------------------
# main


## Get options from ARGV
my %options;
getopts("vhd:p:b:n:c:s:C:F:P:gM:R:A:t:D:H", \%options);

## Version and help options display
use constant versionMsg => "2021 Apr.\n";
use constant usageMsg => <<EOF;
  Usage e.g. : $0 [-d Exome_SNPs_1A -p Triticum_aestivum_IWGSC_RefSeq_v1.0 ] _or_ -b blockId  < IWGSC_RefSeq_v1.0.EXOME_SNPs.chr1A.tsv > Exome_SNPs_1A.json
  Optional params : -n namespace [empty | 90k | ... ]  -c "common name"
  -C columnsKeyString e.g. "chr pos name ref_alt"
  -F field separator, e.g. '\t', default ','
  -P species prefix for chr number, e.g. Ca
  -M column for dataset from Metadata worksheet csv
  -R Chromosome Renaming worksheet csv
  -A array column name
  -t tags
  -D output directory
  -H first line is header line
EOF

my $datasetName = $options{d};
my $parentName = $options{p};
my $blockId = $options{b};
# may be '', which is false-y
my $namespace = defined($options{n}) ? $options{n} : (defined($parentName) ? "$parentName:$datasetName" : $datasetName);
my $commonName = $options{c};
my $shortName = $options{s};	# option, Exome. WGS
my $columnsKeyString = "chr pos name ref_alt";
if (defined($options{C}))
{
  $columnsKeyString = $options{C};
}

my $fieldSeparator = $options{F} || ',';	# '\t'
# Prefix the chr with e.g. 2-letter abbreviation of latin name (e.g. 'Ca')
# The chr input may be just a number, or it may have some other prefix which is trimmed off (see $chrPrefix).
my $chrOutputPrefix = $options{P} || '';

my $datasetMetaFile = $options{M};
my $chromosomeRenamingFile = $options{R};
# An array which is accumulated from preceding lines.
my $arrayColumnName = $options{A};
# Accumulate values from column $arrayColumnName since last Feature.
my $arrayRef = [];

#my $refAltSlash = 0;	# option, default 0
# true means add other columns to Feature.values { }
my $addValues = 1;	# option : add values : { other columns, }
# option : if  $namespace =~ m/90k/ etc,  use  $datasetHeaderGM
my $isGM = $options{g}; # default 0, 1 for physical data blocks

# QTL worksheet may output multiple datasets.
# If undefined, output is to stdout, otherwise create a file named $dataset.json in $outputDir for each dataset.
my $outputDir = $options{D};

my $extraTags = $options{t}; # '"SNP"';  #  . ", \"HighDensity\"";	# option, default ''
if ($extraTags)
{
  # the tags are comma-separated, express them as a comma-separated list of strings wrapped with "".
  $extraTags = '"' . join('", "', split(',', $extraTags)) . '"';
}
else
{
  $extraTags = '';
}

# For loading Genome Reference / Parent :
# my $extraMeta = ''; # '"paths" : "false",'; # '"type" : "Genome",';

my $line1IsHeader = $options{H};

#-------------------------------------------------------------------------------

if ($arrayColumnName)
{
  columnConfig();
  $c_arrayColumnName = defined($columnsKeyLookup{$arrayColumnName}) ? $columnsKeyLookup{$arrayColumnName} : undef;
  # print join(';', keys(%columnsKeyLookup)), ',',  $columnsKeyLookup{'end'}, ',', $arrayColumnName, ', ', $c_arrayColumnName || 'undef', "\n";
}

my $c_Trait = defined($columnsKeyLookup{'Trait'}) ? $columnsKeyLookup{'Trait'} : undef;

#-------------------------------------------------------------------------------

# initialised by makeTemplates()
my $datasetHeader;
my $blockHeader;
my $blockFooter;
my $datasetFooter;
my $datasetHeaderGM;
# true after startDataset()
my $startedDataset = 0;

#-------------------------------------------------------------------------------

sub main()
{
if ($options{v}) {
  print STDERR versionMsg;
}
elsif ($options{h})
{
  print STDERR usageMsg;
}
elsif (defined ($datasetName) == defined ($blockId))
{
  print STDERR usageMsg, <<EOF;
  Required option : -d dataset name or -b block name (not both)
EOF
}
# Maybe drop this test - allow parentName to be optional.
elsif (0 && (defined ($parentName) == defined ($blockId)))
{
  print STDERR usageMsg, <<EOF;
  Required option : -p parent (reference dataset) name or -b block name (not both)
EOF
}
else
{
  makeTemplates();
  # Result %chromosomeRenames is used in snpLine().
  chromosomeRenamePrepare();

  if (! defined ($blockId))
    { 
      createDataset();
    }
  else
    {
      appendToBlock();
    }
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
# End position, optional column.
my $c_endPos;

sub columnConfig() {
  # $columnsKeyString indicates which columns contain the key values
  # e.g. "chr name pos" or "name chr pos end" or "chr pos name ref_alt"
  # Words are separated by single spaces (multiple spaces can be used to indicate columns which are not keys).
  $columnsKeyString  = $ENV{columnsKeyString} || "chr name pos";
  # print "columnsKeyString", $columnsKeyString, "\n";

  # data flow : $columnsKeyString -> $columnsKeyPrefixed -> ColumnsEnum
  # which defines the enums, c_name, c_chr, c_pos etc.
  # Using an enum made sense in the initial version which had fixed columns,
  # but now %columnsKeyLookup is more suitable.
  #
  # $columnsKeyString is space-separated, not comma.
  # column header names which contain spaces are wrapped with "".
  my @a1 = split(/"([^\"]*)"|  */, $columnsKeyString );
  my @columnsKeyValues = grep { $_  } @a1;
  # print 'columnsKeyValues : ', join(':', @columnsKeyValues), "\n";

  for (my $ki=0; $ki <= $#columnsKeyValues; $ki++)
  {
    $columnsKeyLookup{$columnsKeyValues[$ki]} = $ki;
  }
}

BEGIN
{
  columnConfig();
  $columnsKeyPrefixed = $columnsKeyString
    =~ s/,/ /rg
    =~ s/^/c_/r
    =~ s/ / c_/rg;
  # print 'columnsKeyPrefixed : ', $columnsKeyPrefixed, "\n";
  # my @a2 = split(' ', $columnsKeyPrefixed);
  # print 'a2 : ', join(':', @a2), "\n";

  # These columns are identified using variables, (e.g. $c_endPos),
  # because the corresponding enum (e.g. c_endPos) can't have a conditional value.
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
     $line1IsHeader ||
     ($line =~ m/^label	chr	pos/)
     || ($line =~ m/^name,chr,pos/)
     || (($line =~ m/Marker|Name/i) && ($line =~ m/Chromosome/i))
     || ($line =~ m/Contig,Position/i)
    );
  if ($isHeader) {
    @columnHeaders = map { trimOutsideQuotesAndSpaces($_); } split($fieldSeparator);
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

# slightly more complete - handle hash or array, or a hash with an array value
# @param $indent
# @param $data
sub encode_json_2($$)
{
  my ($indent, $data) = @_;

  my $json;
  if (reftype $data eq 'ARRAY')
  {
    my $quote = $#$data ? '"' : '';
    $json = '[' . $quote . join('"' . ",\n" . $indent . '"' , @$data) . $quote . ']';

  }
  elsif (reftype $data eq 'HASH')
  {
    my @fields = ();
    for my $key (keys %$data) {
      my $value = $data->{$key};
      my $valueString = (reftype \$value eq 'SCALAR') ?
        '"' . $value . '"'
        : encode_json_2($indent . '  ', $value);
      push @fields, '"' . $key . '" : ' . $valueString;
    }
    $json = '{' . join(",\n" . $indent, @fields) . '}';
  }
  else
  {
    $json = '"' . $data . '"';
  }

  return $json;
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

}


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


#-------------------------------------------------------------------------------

# Value of chr (chromosome) on the previous line, or undefined on the first line
my $lastChr;
# Non-empty value of Trait from a previous line, or undefined on the first line
my $currentTrait;
my $blockSeparator;

#-------------------------------------------------------------------------------

main();

#-------------------------------------------------------------------------------

sub createDataset()
{
  if ($isGM) {
    $datasetHeader = $datasetHeaderGM;
  }

  if (! $outputDir)
  {
    print $datasetHeader;
  }

  convertInput();

  optionalBlockFooter();
  print $datasetFooter;
}
sub startDataset()
{
  print $datasetHeader;
  $startedDataset = 1;
}
sub endDataset()
{
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
sub chromosomeRenamePrepare()
{
  if (defined($chromosomeRenamingFile) && $chromosomeRenamingFile)
  {
    if (! open(FH, '<', $chromosomeRenamingFile))
    { warn $!, "'$chromosomeRenamingFile'\n"; }
    else
    {
      while(<FH>){
        chomp;
        # Skip empty lines.
        ! $_ && continue;
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
  @a = map { trimOutsideQuotesAndSpaces($_) } @a;

  if (defined($c_arrayColumnName) && $a[$c_arrayColumnName])
  {
    push @$arrayRef, $a[$c_arrayColumnName];
  }

  # Skip blank lines
  if (! $a[c_name] && ! $a[c_chr])
  {
    # Could output a warning if the line is not blank, i.e. not /^,,,/, or $a[c_pos]
    return;
  }
  # For QTL : Flanking Marker by itself in a row is added as a feature
  # to current block / QTL
  elsif ($a[c_name] && ! $a[c_chr] && ! $a[c_pos] &&
         defined($c_Trait) && $columnsKeyLookup{'parentname'})
  {
    $a[c_pos] = 'null';
    $a[$c_endPos] = '';
  }
  elsif (defined($c_Trait))
  {
    # If trait is blank / empty, use current.
    if ($a[$c_Trait])
    {
      $currentTrait = $a[$c_Trait];
    }
    else
    {
      $a[$c_Trait] = $currentTrait;
    }
  }

  # $a[c_chr] = trimOutsideQuotesAndSpaces($a[c_chr]);
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
    # Apply to Scope column, or Chromosome.
    my $c_scope = $columnsKeyLookup{'Scope'};
    my $col = defined($c_scope) ? $c_scope : c_chr;
    my $toName = $chromosomeRenames{deletePunctuation($a[$col])};
    if (defined($toName))
    {
      $chromosomeRenamedFrom = $a[$col];
      $a[$col] = $toName;
    }
  }

  $a[c_name] = markerPrefix($a[c_name]);

  # start new Dataset when change in parentName 
  my $c_parentName = $columnsKeyLookup{'parentname'};
  if (defined($c_parentName))
  {
    $parentName = $a[$c_parentName];
    if ($parentName)
    {
      $datasetName = $currentTrait;
      makeTemplates();
      if ($startedDataset)
      {
        endDataset();
      }
      $lastChr = undef;
      $blockSeparator = undef;
      if ($outputDir)
      {
        my $datasetOutFile = "$outputDir/$datasetName.json";
        # re-open stdout
        open(my $oldStdout, ">&STDOUT")     or die "Can't dup STDOUT: $!";
        open(STDOUT, '>', $datasetOutFile) or die "Can't redirect STDOUT to '$datasetOutFile': $!";
      }
      startDataset();
    }
  }


  # If Chromosome has changed, end the block and start a new block.
  # If Chromosome is empty / blank, use current ($lastChr).
  my $c = $a[c_chr];
  if (! defined($lastChr) || ($c && ($lastChr ne $c)))
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
          # Use Scope column if given.
          my $c_scope = $columnsKeyLookup{'Scope'};
          my $scope = defined($c_scope) ? $a[$c_scope] : $c;   #  ($c =~ s/\.[1-9]$//r);
          $h =~ s/blockName/$c/g;
          $h =~ s/blockScope/$scope/g;
          print $h;

          # create block (and nominal feature) and feature.  use scope and parentName,
          # Start/End are block range, or create a nominal feature for the block
          # (could put extra columns values in this, or in block.meta)

          # Output nominal feature of block
          # printFeature(@a); # done below
          my $c_parentName = $columnsKeyLookup{'parentName'};
          if (defined($c_parentName))
          {
            my @f = ();
            $f[c_name] = $a[c_name];
            $f[c_pos] = 'null';
            if (defined($c_endPos))
            { $f[$c_endPos] = ''; }
            printFeature(@f);
            # print feature separator
            print ",";
          }
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
    # print "enums", join(';', (c_name, c_chr, c_pos, c_start, $c_endPos)), "\n";
    # could also match @columnHeaders
    for (my $ci=0; $ci <= $#a; $ci++)
    {
      my $columnHeader = $columnHeaders[$ci];

      # if the column is not already used (one of the essential/"key"
      # columns), and the value is non-empty, and it has a column heading,
      # then add it to .values
      # print $ci, ', columnHeader:', $columnHeader, ",", $a[$ci], "\n";
      if (($ci != c_name) && ($ci != c_chr) && ($ci != c_pos) && ($ci != c_start) && (! defined($c_endPos) || ($ci != $c_endPos))
          && $a[$ci] && ($ci <= $#columnHeaders) && $columnHeader && ! isComment($columnHeader))
      {
        # equivalent : ($ci == $c_arrayColumnName)
        if ($arrayColumnName && ($columnHeader eq $arrayColumnName))
        {
          $values{$columnHeader} = $arrayRef;
          $arrayRef = [];
        }
        else
        {
          $values{$columnHeader} = $a[$ci];
        }
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
    ",\n" . $indent . "\"values\" : " .
    encode_json_2("        ", \%values)
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
